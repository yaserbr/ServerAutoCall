const test = require("node:test");
const assert = require("node:assert/strict");

const Command = require("../src/models/Command");
const CommandCollection = require("../src/models/CommandCollection");
const CommandCollectionService = require("../src/services/commandCollectionService");

function createQuery(value) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return Promise.resolve(value);
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    }
  };
}

test("collection steps have a deterministic idempotency key and durable schedule", () => {
  const executionAt = new Date(Date.now() + 30_000);
  const collection = {
    _id: "collection-123",
    name: "Morning",
    deviceUid: "abc12",
    ownerUserId: "owner-1",
    deviceOwnershipEpoch: "ownership-1",
    commandTemplates: [
      { action: "open_app", type: "OPEN_APP", appName: "Settings", delayAfterSeconds: 30 }
    ]
  };

  const first = CommandCollectionService.buildCommandData(collection, 0, executionAt);
  const replay = CommandCollectionService.buildCommandData(collection, 0, executionAt);

  assert.equal(first.idempotencyKey, "collection:collection-123:step:0");
  assert.equal(replay.idempotencyKey, first.idempotencyKey);
  assert.equal(first.isImmediate, false);
  assert.equal(first.scheduledAt.toISOString(), executionAt.toISOString());
});

test("workflow persistence has the indexes required for recovery and duplicate prevention", () => {
  const commandIndexes = Command.schema.indexes();
  const collectionIndexes = CommandCollection.schema.indexes();

  const idempotencyIndex = commandIndexes.find(
    ([fields, options]) =>
      fields.idempotencyKey === 1 && options.name === "collection_step_idempotency"
  );
  assert.ok(idempotencyIndex);
  assert.equal(idempotencyIndex[1].unique, true);
  assert.deepEqual(idempotencyIndex[1].partialFilterExpression, {
    idempotencyKey: { $type: "string" }
  });

  assert.ok(
    collectionIndexes.some(
      ([fields, options]) =>
        fields.status === 1 && fields._id === 1 && options.name === "collection_workflow_recovery"
    )
  );
  assert.ok(CommandCollection.schema.path("nextExecutionAt"));
});

test("workflow writes use a MongoDB transaction when the deployment supports it", async () => {
  const originalAdapter = CommandCollectionService.mongooseAdapter;
  const originalTransactionsSupported = CommandCollectionService.transactionsSupported;
  const calls = [];
  const session = {
    async withTransaction(callback, options) {
      calls.push({ type: "transaction", options });
      await callback();
    },
    async endSession() {
      calls.push({ type: "end" });
    }
  };
  CommandCollectionService.mongooseAdapter = {
    connection: { readyState: 1 },
    async startSession() {
      calls.push({ type: "start" });
      return session;
    }
  };
  CommandCollectionService.transactionsSupported = null;

  try {
    const result = await CommandCollectionService.runWorkflowTransaction(async (activeSession) => {
      assert.equal(activeSession, session);
      return "committed";
    });

    assert.equal(result, "committed");
    assert.deepEqual(calls.map((entry) => entry.type), ["start", "transaction", "end"]);
    assert.deepEqual(calls[1].options.writeConcern, { w: "majority" });
  } finally {
    CommandCollectionService.mongooseAdapter = originalAdapter;
    CommandCollectionService.transactionsSupported = originalTransactionsSupported;
  }
});

test("workflow execution fails closed when transactional storage is unavailable", async () => {
  const originalAdapter = CommandCollectionService.mongooseAdapter;
  const originalTransactionsSupported = CommandCollectionService.transactionsSupported;
  let workCalled = false;
  CommandCollectionService.mongooseAdapter = {
    connection: { readyState: 0 }
  };
  CommandCollectionService.transactionsSupported = null;

  try {
    await assert.rejects(
      CommandCollectionService.runWorkflowTransaction(async () => {
        workCalled = true;
      }),
      (error) => error?.statusCode === 503
    );
    assert.equal(workCalled, false);
  } finally {
    CommandCollectionService.mongooseAdapter = originalAdapter;
    CommandCollectionService.transactionsSupported = originalTransactionsSupported;
  }
});

test("restart recovery resumes pending collections and terminal callbacks idempotently", async () => {
  const originals = {
    CollectionModel: CommandCollectionService.CollectionModel,
    CommandModel: CommandCollectionService.CommandModel,
    queueNextCommand: CommandCollectionService.queueNextCommand,
    handleCommandStatusChange: CommandCollectionService.handleCommandStatusChange,
    notifyCommandOnce: CommandCollectionService.notifyCommandOnce,
    recoveryRunning: CommandCollectionService.recoveryRunning
  };
  const pendingCollection = {
    _id: "collection-1",
    status: "pending",
    currentIndex: 0,
    activeCommandIds: [null]
  };
  const terminalCollection = {
    _id: "collection-2",
    status: "executing",
    currentIndex: 0,
    activeCommandIds: ["command-2"]
  };
  const waitingCollection = {
    _id: "collection-3",
    status: "executing",
    currentIndex: 0,
    activeCommandIds: ["command-3"]
  };
  const actions = [];

  CommandCollectionService.CollectionModel = {
    find: () => createQuery([pendingCollection, terminalCollection, waitingCollection])
  };
  CommandCollectionService.CommandModel = {
    findById(commandId) {
      if (commandId === "command-2") {
        return createQuery({
          _id: commandId,
          status: "executed",
          failureReason: null
        });
      }
      return createQuery({ _id: commandId, status: "pending" });
    }
  };
  CommandCollectionService.queueNextCommand = async (collection) => {
    actions.push(`queue:${collection._id}`);
  };
  CommandCollectionService.handleCommandStatusChange = async (commandId, status) => {
    actions.push(`transition:${commandId}:${status}`);
  };
  CommandCollectionService.notifyCommandOnce = async (command) => {
    actions.push(`notify:${command._id}`);
  };
  CommandCollectionService.recoveryRunning = false;

  try {
    await CommandCollectionService.recoverUnfinishedCollections();
    assert.deepEqual(actions, [
      "queue:collection-1",
      "transition:command-2:executed",
      "notify:command-3"
    ]);
  } finally {
    Object.assign(CommandCollectionService, originals);
  }
});

test("concurrent durable notification attempts emit a collection command at most once", async () => {
  const originals = {
    CommandModel: CommandCollectionService.CommandModel,
    io: CommandCollectionService.io,
    mapCommandForResponse: CommandCollectionService.mapCommandForResponse
  };
  const command = { _id: "command-1", deviceUid: "abc12", status: "pending" };
  let claimed = false;
  const emitted = [];

  CommandCollectionService.CommandModel = {
    findOneAndUpdate() {
      if (claimed) return createQuery(null);
      claimed = true;
      return createQuery({ ...command, workflowNotifiedAt: new Date() });
    }
  };
  CommandCollectionService.io = {
    to(room) {
      return {
        emit(event) {
          emitted.push(`${room}:${event}`);
        }
      };
    }
  };
  CommandCollectionService.mapCommandForResponse = (value) => value;

  try {
    const results = await Promise.all([
      CommandCollectionService.notifyCommandOnce(command),
      CommandCollectionService.notifyCommandOnce(command)
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(await CommandCollectionService.notifyCommandOnce(command), false);
    assert.deepEqual(emitted, [
      "device:abc12:command:new",
      "dashboard:abc12:command:created"
    ]);
  } finally {
    Object.assign(CommandCollectionService, originals);
  }
});
