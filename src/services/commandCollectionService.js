const mongoose = require("mongoose");
const Command = require("../models/Command");
const Device = require("../models/Device");
const CommandCollection = require("../models/CommandCollection");
const { ensureDeviceOwnershipEpoch } = require("../security/deviceOwnership");
const { safeErrorMetadata } = require("../security/safeError");

const MAX_DELAY_AFTER_SECONDS = 3600;
const RECOVERY_BATCH_SIZE = 100;
const RECOVERY_INTERVAL_MS = 15_000;
const TERMINAL_COMMAND_STATUSES = new Set(["executed", "failed", "cancelled"]);
const ACTIVE_COLLECTION_STATUSES = ["pending", "executing"];

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function createAuthorizationError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

function createWorkflowUnavailableError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function isSameOwner(left, right) {
  return Boolean(left) && Boolean(right) && String(left) === String(right);
}

function applySession(query, session) {
  return session && typeof query?.session === "function" ? query.session(session) : query;
}

function isUnsupportedTransactionError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    error?.code === 20 ||
    error?.codeName === "IllegalOperation" ||
    message.includes("Transaction numbers are only allowed") ||
    message.includes("does not support transactions")
  );
}

function buildCollectionCommandIdempotencyKey(collectionId, stepIndex) {
  return `collection:${String(collectionId)}:step:${Number(stepIndex)}`;
}

function setIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== "") target[key] = value;
}

class CommandCollectionService {
  static io = null;
  static mapCommandForResponse = null;
  static schedulerIntervalId = null;
  static recoveryRunning = false;
  static CommandModel = Command;
  static DeviceModel = Device;
  static CollectionModel = CommandCollection;
  static mongooseAdapter = mongoose;
  static transactionsSupported = null;

  static initialize(io, mapCommandForResponse) {
    this.io = io;
    this.mapCommandForResponse = mapCommandForResponse;
    console.log("[CommandCollection Service] Initialized durable collection workflow.");
  }

  static normalizeDelayAfterSeconds(value, templateIndex) {
    if (value === undefined || value === null || value === "") return 0;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw createValidationError(
        `delayAfterSeconds for command template at index ${templateIndex} must be a number.`
      );
    }
    if (value < 0 || value > MAX_DELAY_AFTER_SECONDS) {
      throw createValidationError(
        `delayAfterSeconds for command template at index ${templateIndex} must be between 0 and ${MAX_DELAY_AFTER_SECONDS}.`
      );
    }
    return value;
  }

  static async runWorkflowTransaction(work) {
    const adapter = this.mongooseAdapter;
    if (
      adapter?.connection?.readyState !== 1 ||
      typeof adapter?.startSession !== "function"
    ) {
      throw createWorkflowUnavailableError(
        "MongoDB is unavailable for durable collection execution."
      );
    }
    if (this.transactionsSupported === false) {
      throw createWorkflowUnavailableError(
        "MongoDB transactions are required for durable collection execution."
      );
    }

    const session = await adapter.startSession();
    try {
      let result;
      await session.withTransaction(
        async () => {
          result = await work(session);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" }
        }
      );
      this.transactionsSupported = true;
      return result;
    } catch (error) {
      if (!isUnsupportedTransactionError(error)) throw error;
      this.transactionsSupported = false;
      throw createWorkflowUnavailableError(
        "MongoDB transactions are required for durable collection execution."
      );
    } finally {
      await session.endSession();
    }
  }

  static async createAndStartCollection(name, deviceUid, templates, ownerUserId = null) {
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Collection name is required.");
    }
    if (!deviceUid || typeof deviceUid !== "string" || deviceUid.trim().length !== 5) {
      throw new Error("Device UID must be exactly 5 characters.");
    }

    const normalizedDeviceUid = deviceUid.trim().toLowerCase();
    const device = await this.DeviceModel.findOne({ deviceUid: normalizedDeviceUid }).select(
      "+ownershipEpoch"
    );
    if (!device) {
      throw new Error(`Device with UID '${normalizedDeviceUid}' was not found.`);
    }
    if (!isSameOwner(device.ownerUserId, ownerUserId)) {
      throw createAuthorizationError("Device ownership changed before collection execution.");
    }
    if (!(await ensureDeviceOwnershipEpoch(device))) {
      throw new Error("Device ownership state could not be initialized.");
    }
    if (!Array.isArray(templates) || templates.length === 0) {
      throw new Error("A command collection must contain at least one command template.");
    }

    const processedTemplates = templates.map((template, index) => {
      if (!template.action) {
        throw new Error(`Command template at index ${index} is missing 'action' field.`);
      }
      const action = String(template.action).trim().toLowerCase();
      const type = template.type
        ? String(template.type).trim().toUpperCase()
        : action.toUpperCase();
      return {
        ...template,
        action,
        type,
        delayAfterSeconds: this.normalizeDelayAfterSeconds(
          template.delayAfterSeconds,
          index
        )
      };
    });

    const now = new Date();
    const collection = new this.CollectionModel({
      name: name.trim(),
      deviceUid: normalizedDeviceUid,
      ownerUserId,
      deviceOwnershipEpoch: device.ownershipEpoch,
      commandTemplates: processedTemplates,
      activeCommandIds: new Array(processedTemplates.length).fill(null),
      status: "pending",
      currentIndex: 0,
      nextExecutionAt: now,
      workflowUpdatedAt: now
    });

    await collection.save();

    // The first durable command is created before preserving the existing API
    // response. Subsequent delays are represented by scheduledAt in MongoDB and
    // never hold the status-update HTTP request open.
    return this.queueNextCommand(collection);
  }

  static buildCommandData(collection, stepIndex, executionAt) {
    const template = collection.commandTemplates[stepIndex];
    const now = new Date();
    const parsedExecutionAt = executionAt ? new Date(executionAt) : now;
    const isFuture = parsedExecutionAt.getTime() > now.getTime();
    const commandData = {
      deviceUid: collection.deviceUid,
      ownerUserId: collection.ownerUserId,
      deviceOwnershipEpoch: collection.deviceOwnershipEpoch,
      action: template.action,
      type: template.type,
      notes: template.notes || `Step ${stepIndex + 1} of collection: ${collection.name}`,
      collectionId: collection._id,
      collectionName: collection.name,
      collectionStepIndex: stepIndex,
      collectionTotalSteps: collection.commandTemplates.length,
      idempotencyKey: buildCollectionCommandIdempotencyKey(collection._id, stepIndex),
      status: "pending",
      isImmediate: !isFuture,
      createdAt: now
    };

    if (isFuture) commandData.scheduledAt = parsedExecutionAt;
    for (const key of [
      "phoneNumber",
      "message",
      "url",
      "appName",
      "resolvedPackageName",
      "durationSeconds",
      "downloadSizeMb",
      "downloadDurationSeconds",
      "activationCode",
      "esimSubscriptionId",
      "esimPortIndex",
      "subscriptionId",
      "enabled",
      "autoHangupSeconds",
      "x",
      "y",
      "screenWidth",
      "screenHeight",
      "startX",
      "startY",
      "endX",
      "endY",
      "durationMs",
      "touchTarget"
    ]) {
      setIfPresent(commandData, key, template[key]);
    }

    return commandData;
  }

  static async upsertStepCommand(collection, stepIndex, executionAt, session) {
    const commandData = this.buildCommandData(collection, stepIndex, executionAt);
    const candidate = new this.CommandModel(commandData);
    if (typeof candidate.validate === "function") await candidate.validate();
    const insertData =
      typeof candidate.toObject === "function"
        ? candidate.toObject({ depopulate: true, versionKey: false })
        : commandData;

    const writeResult = await this.CommandModel.updateOne(
      { idempotencyKey: commandData.idempotencyKey },
      { $setOnInsert: insertData },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        ...(session ? { session } : {})
      }
    );
    const command = await applySession(
      this.CommandModel.findOne({ idempotencyKey: commandData.idempotencyKey }).select(
        "+idempotencyKey +workflowNotifiedAt +deviceOwnershipEpoch"
      ),
      session
    );
    if (!command) throw new Error("Collection command could not be persisted.");

    return {
      command,
      created: Number(writeResult?.upsertedCount || 0) === 1 || Boolean(writeResult?.upsertedId)
    };
  }

  static async cancelForOwnershipChange(collection, session) {
    const now = new Date();
    return applySession(
      this.CollectionModel.findOneAndUpdate(
        { _id: collection._id, status: { $in: ACTIVE_COLLECTION_STATUSES } },
        {
          $set: {
            status: "cancelled",
            completedAt: now,
            nextExecutionAt: null,
            workflowUpdatedAt: now
          },
          $inc: { workflowRevision: 1 }
        },
        { new: true, ...(session ? { session } : {}) }
      ).select("+deviceOwnershipEpoch +workflowRevision"),
      session
    );
  }

  static async queueNextCommand(collection) {
    const collectionId = collection?._id ?? collection;
    const result = await this.runWorkflowTransaction(async (session) => {
      const currentCollection = await applySession(
        this.CollectionModel.findById(collectionId).select(
          "+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt"
        ),
        session
      );
      if (!currentCollection || !ACTIVE_COLLECTION_STATUSES.includes(currentCollection.status)) {
        return { collection: currentCollection, command: null };
      }

      const stepIndex = Number(currentCollection.currentIndex);
      if (
        !Number.isInteger(stepIndex) ||
        stepIndex < 0 ||
        stepIndex >= currentCollection.commandTemplates.length
      ) {
        throw new Error("Collection currentIndex is outside the command template range.");
      }

      const activePath = `activeCommandIds.${stepIndex}`;
      const existingCommandId = currentCollection.activeCommandIds?.[stepIndex];
      if (existingCommandId) {
        const existingCommand = await applySession(
          this.CommandModel.findById(existingCommandId).select(
            "+idempotencyKey +workflowNotifiedAt +deviceOwnershipEpoch"
          ),
          session
        );
        if (existingCommand) {
          const resumedCollection = await applySession(
            this.CollectionModel.findOneAndUpdate(
              {
                _id: currentCollection._id,
                currentIndex: stepIndex,
                status: { $in: ACTIVE_COLLECTION_STATUSES },
                [activePath]: existingCommandId
              },
              {
                $set: {
                  status: "executing",
                  nextExecutionAt:
                    existingCommand.scheduledAt || currentCollection.nextExecutionAt || new Date(),
                  workflowUpdatedAt: new Date()
                },
                $inc: { workflowRevision: 1 }
              },
              { new: true, ...(session ? { session } : {}) }
            ).select("+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt"),
            session
          );
          return {
            collection: resumedCollection || currentCollection,
            command: existingCommand
          };
        }
      }

      const currentDevice = await applySession(
        this.DeviceModel.findOne({ deviceUid: currentCollection.deviceUid }).select(
          "+ownershipEpoch"
        ),
        session
      );
      const ownershipMatches =
        currentDevice &&
        isSameOwner(currentDevice.ownerUserId, currentCollection.ownerUserId) &&
        currentDevice.ownershipEpoch === currentCollection.deviceOwnershipEpoch;
      if (!ownershipMatches) {
        await this.cancelForOwnershipChange(currentCollection, session);
        return { collection: currentCollection, command: null, ownershipChanged: true };
      }

      const executionAt = currentCollection.nextExecutionAt || new Date();
      const { command } = await this.upsertStepCommand(
        currentCollection,
        stepIndex,
        executionAt,
        session
      );
      const allowedActiveValues = [
        { [activePath]: { $exists: false } },
        { [activePath]: null },
        { [activePath]: command._id }
      ];
      if (existingCommandId) allowedActiveValues.push({ [activePath]: existingCommandId });

      const now = new Date();
      const updatedCollection = await applySession(
        this.CollectionModel.findOneAndUpdate(
          {
            _id: currentCollection._id,
            currentIndex: stepIndex,
            status: { $in: ACTIVE_COLLECTION_STATUSES },
            $or: allowedActiveValues
          },
          {
            $set: {
              [activePath]: command._id,
              status: "executing",
              nextExecutionAt: new Date(executionAt),
              workflowUpdatedAt: now
            },
            $inc: { workflowRevision: 1 }
          },
          { new: true, ...(session ? { session } : {}) }
        ).select("+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt"),
        session
      );
      if (!updatedCollection) {
        throw new Error("Collection step changed while it was being dispatched.");
      }
      return { collection: updatedCollection, command };
    });

    if (result?.ownershipChanged) {
      throw createAuthorizationError("Device ownership changed during collection execution.");
    }
    if (result?.command) await this.notifyCommandOnce(result.command);
    return result?.collection || collection;
  }

  static async notifyCommandOnce(command) {
    if (!command?._id || !this.io || !this.mapCommandForResponse) return false;

    const commandToNotify = await this.CommandModel.findOneAndUpdate(
      {
        _id: command._id,
        status: "pending",
        workflowNotifiedAt: null
      },
      { $set: { workflowNotifiedAt: new Date() } },
      { new: true }
    ).select("+workflowNotifiedAt +deviceOwnershipEpoch");
    if (!commandToNotify) return false;

    try {
      const formattedCommand = this.mapCommandForResponse(commandToNotify);
      this.io.to(`device:${commandToNotify.deviceUid}`).emit("command:new", formattedCommand);
      this.io
        .to(`dashboard:${commandToNotify.deviceUid}`)
        .emit("command:created", formattedCommand);
      return true;
    } catch (error) {
      console.error(
        "[CommandCollection Service] Failed to broadcast durable command notification:",
        safeErrorMetadata(error)
      );
      return false;
    }
  }

  static async handleCommandStatusChange(
    commandId,
    newStatus,
    _failureReason = "",
    preloadedCommand = null
  ) {
    if (!commandId) return;
    const normalizedStatus = String(newStatus).trim().toLowerCase();
    if (!TERMINAL_COMMAND_STATUSES.has(normalizedStatus)) return;

    try {
      const command =
        preloadedCommand && String(preloadedCommand._id) === String(commandId)
          ? preloadedCommand
          : await this.CommandModel.findById(commandId).select("+deviceOwnershipEpoch");
      if (!command) return;

      const result = await this.runWorkflowTransaction(async (session) => {
        const collection = await applySession(
          this.CollectionModel.findOne({
            deviceUid: command.deviceUid,
            ownerUserId: command.ownerUserId,
            deviceOwnershipEpoch: command.deviceOwnershipEpoch,
            status: "executing",
            activeCommandIds: { $in: [command._id, String(command._id)] }
          }).select("+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt"),
          session
        );
        if (!collection) return null;

        const stepIndex = Number(collection.currentIndex);
        const activePath = `activeCommandIds.${stepIndex}`;
        const expectedCommandId = collection.activeCommandIds?.[stepIndex];
        if (!expectedCommandId || String(expectedCommandId) !== String(commandId)) return null;

        const transitionFilter = {
          _id: collection._id,
          status: "executing",
          currentIndex: stepIndex,
          [activePath]: expectedCommandId
        };
        const now = new Date();

        if (normalizedStatus === "failed" || normalizedStatus === "cancelled") {
          const haltedCollection = await applySession(
            this.CollectionModel.findOneAndUpdate(
              transitionFilter,
              {
                $set: {
                  status: normalizedStatus === "cancelled" ? "cancelled" : "failed",
                  completedAt: now,
                  nextExecutionAt: null,
                  workflowUpdatedAt: now
                },
                $inc: { workflowRevision: 1 }
              },
              { new: true, ...(session ? { session } : {}) }
            ).select("+deviceOwnershipEpoch +workflowRevision"),
            session
          );
          return { collection: haltedCollection, command: null };
        }

        if (stepIndex + 1 >= collection.commandTemplates.length) {
          const completedCollection = await applySession(
            this.CollectionModel.findOneAndUpdate(
              transitionFilter,
              {
                $set: {
                  status: "executed",
                  completedAt: now,
                  nextExecutionAt: null,
                  workflowUpdatedAt: now
                },
                $inc: { workflowRevision: 1 }
              },
              { new: true, ...(session ? { session } : {}) }
            ).select("+deviceOwnershipEpoch +workflowRevision"),
            session
          );
          return { collection: completedCollection, command: null };
        }

        const currentDevice = await applySession(
          this.DeviceModel.findOne({ deviceUid: collection.deviceUid }).select(
            "+ownershipEpoch"
          ),
          session
        );
        const ownershipMatches =
          currentDevice &&
          isSameOwner(currentDevice.ownerUserId, collection.ownerUserId) &&
          currentDevice.ownershipEpoch === collection.deviceOwnershipEpoch;
        if (!ownershipMatches) {
          const cancelledCollection = await this.cancelForOwnershipChange(collection, session);
          return { collection: cancelledCollection, command: null };
        }

        const delayAfterSeconds = this.normalizeDelayAfterSeconds(
          collection.commandTemplates[stepIndex]?.delayAfterSeconds,
          stepIndex
        );
        const nextStepIndex = stepIndex + 1;
        const nextExecutionAt = new Date(now.getTime() + delayAfterSeconds * 1000);
        const { command: nextCommand } = await this.upsertStepCommand(
          collection,
          nextStepIndex,
          nextExecutionAt,
          session
        );
        const nextActivePath = `activeCommandIds.${nextStepIndex}`;
        const advancedCollection = await applySession(
          this.CollectionModel.findOneAndUpdate(
            transitionFilter,
            {
              $set: {
                currentIndex: nextStepIndex,
                [nextActivePath]: nextCommand._id,
                status: "executing",
                nextExecutionAt,
                completedAt: null,
                workflowUpdatedAt: now
              },
              $inc: { workflowRevision: 1 }
            },
            { new: true, ...(session ? { session } : {}) }
          ).select("+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt"),
          session
        );
        if (!advancedCollection) {
          throw new Error("Collection state changed while advancing to the next step.");
        }
        return { collection: advancedCollection, command: nextCommand };
      });

      if (result?.command) await this.notifyCommandOnce(result.command);
    } catch (error) {
      // The terminal command is already durable. Recovery will retry this
      // idempotent transition if a transient failure occurs here.
      console.error(
        "[CommandCollection Service] Durable workflow transition failed:",
        safeErrorMetadata(error)
      );
    }
  }

  static async recoverUnfinishedCollections() {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;

    try {
      let lastCollectionId = null;
      while (true) {
        const filter = {
          status: { $in: ACTIVE_COLLECTION_STATUSES },
          ...(lastCollectionId ? { _id: { $gt: lastCollectionId } } : {})
        };
        const collections = await this.CollectionModel.find(filter)
          .select("+deviceOwnershipEpoch +workflowRevision +workflowUpdatedAt")
          .sort({ _id: 1 })
          .limit(RECOVERY_BATCH_SIZE);
        if (!collections.length) break;

        for (const collection of collections) {
          try {
            const stepIndex = Number(collection.currentIndex);
            const activeCommandId = collection.activeCommandIds?.[stepIndex];
            if (collection.status === "pending" || !activeCommandId) {
              await this.queueNextCommand(collection);
              continue;
            }

            const command = await this.CommandModel.findById(activeCommandId).select(
              "+deviceOwnershipEpoch +workflowNotifiedAt"
            );
            if (!command) {
              await this.queueNextCommand(collection);
            } else if (TERMINAL_COMMAND_STATUSES.has(command.status)) {
              await this.handleCommandStatusChange(
                String(command._id),
                command.status,
                command.failureReason,
                command
              );
            } else if (command.status === "pending") {
              await this.notifyCommandOnce(command);
            }
          } catch (error) {
            console.error("[CommandCollection Service] Collection recovery failed:", {
              collectionId: String(collection._id),
              ...safeErrorMetadata(error)
            });
          }
        }

        lastCollectionId = collections.at(-1)._id;
        if (collections.length < RECOVERY_BATCH_SIZE) break;
      }
    } finally {
      this.recoveryRunning = false;
    }
  }

  static async startScheduler() {
    if (this.schedulerIntervalId) return;
    if (this.mongooseAdapter?.connection?.readyState !== 1) {
      console.warn("[CommandCollection Service] Durable scheduler not started: MongoDB unavailable.");
      return;
    }

    // Ensure the unique idempotency constraint exists before any recovery
    // worker or HTTP request can create a collection command.
    await Promise.all([this.CommandModel.init(), this.CollectionModel.init()]);
    // Force a real transactional read during startup. A standalone MongoDB
    // deployment fails here instead of accepting workflows without atomicity.
    await this.runWorkflowTransaction(async (session) => {
      await applySession(
        this.CollectionModel.findOne({ _id: null }).select("_id"),
        session
      );
    });
    await this.recoverUnfinishedCollections();
    this.schedulerIntervalId = setInterval(() => {
      this.recoverUnfinishedCollections().catch((error) => {
        console.error(
          "[CommandCollection Service] Recovery sweep failed:",
          safeErrorMetadata(error)
        );
      });
    }, RECOVERY_INTERVAL_MS);
    if (typeof this.schedulerIntervalId.unref === "function") {
      this.schedulerIntervalId.unref();
    }
  }

  static stopScheduler() {
    if (!this.schedulerIntervalId) return;
    clearInterval(this.schedulerIntervalId);
    this.schedulerIntervalId = null;
  }

  static buildCollectionCommandIdempotencyKey(collectionId, stepIndex) {
    return buildCollectionCommandIdempotencyKey(collectionId, stepIndex);
  }
}

module.exports = CommandCollectionService;
