/**
 * test-collection.js
 * 
 * Standalone unit test suite for the Sequential Command Collection feature.
 * Verifies that CommandCollectionService handles sequential queuing,
 * target device validation, and status-based progression / halting.
 */

const assert = require("assert");

// Mock Mongoose and models so we can unit test the logic without a live MongoDB database
const mockSavedCollections = [];
const mockSavedCommands = [];

// 1. Mock Device Model
const mockDeviceDb = [
  { deviceUid: "xy99z", deviceName: "Lab-Testing-Node", platform: "Android", online: true, ownerUserId: "60c72b2f9b1d8e256c8d1111" }
];

const DeviceMock = {
  findOne: async (query) => {
    return mockDeviceDb.find(d => d.deviceUid === query.deviceUid) || null;
  }
};

// 2. Mock Command Model
class CommandMock {
  constructor(data) {
    Object.assign(this, data);
    this._id = "cmd_" + Math.random().toString(36).slice(2, 11);
  }

  async save() {
    const existingIdx = mockSavedCommands.findIndex(c => String(c._id) === String(this._id));
    if (existingIdx !== -1) {
      mockSavedCommands[existingIdx] = this;
    } else {
      mockSavedCommands.push(this);
    }
    return this;
  }

  static async findById(id) {
    return mockSavedCommands.find(c => String(c._id) === String(id)) || null;
  }
}

// 3. Mock CommandCollection Model
class CommandCollectionMock {
  constructor(data) {
    Object.assign(this, data);
    this._id = "col_" + Math.random().toString(36).slice(2, 11);
    this.createdAt = new Date();
    this.completedAt = null;
  }

  markModified(path) {
    // Mock no-op for testing
  }

  async save() {
    const existingIdx = mockSavedCollections.findIndex(c => String(c._id) === String(this._id));
    if (existingIdx !== -1) {
      mockSavedCollections[existingIdx] = this;
    } else {
      mockSavedCollections.push(this);
    }
    return this;
  }

  static async findOne(query) {
    if (query.activeCommandIds) {
      let idsToMatch = [];
      if (query.activeCommandIds.$in) {
        idsToMatch = query.activeCommandIds.$in.map(id => String(id));
      } else {
        idsToMatch = [String(query.activeCommandIds)];
      }

      return mockSavedCollections.find(c => {
        const hasId = c.activeCommandIds.some(id => idsToMatch.includes(String(id)));
        const statusMatches = query.status ? c.status === query.status : true;
        return hasId && statusMatches;
      }) || null;
    }
    return null;
  }

  static async find(query) {
    return mockSavedCollections.filter(c => {
      const deviceMatches = query.deviceUid ? c.deviceUid === query.deviceUid : true;
      const statusMatches = query.status ? c.status === query.status : true;
      return deviceMatches && statusMatches;
    });
  }
}

// Intercept require calls to inject mock models
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path.endsWith("../models/Device") || path.endsWith("./src/models/Device")) {
    return DeviceMock;
  }
  if (path.endsWith("../models/Command") || path.endsWith("./src/models/Command")) {
    return CommandMock;
  }
  if (path.endsWith("../models/CommandCollection") || path.endsWith("./src/models/CommandCollection")) {
    return CommandCollectionMock;
  }
  return originalRequire.apply(this, arguments);
};

// Now import our CommandCollectionService with mocked models injected
const CommandCollectionService = require("./src/services/commandCollectionService");

async function runTests() {
  console.log("🚀 Starting Sequential Command Collection Verification Tests...\n");

  // Reset collections & commands mock databases
  mockSavedCollections.length = 0;
  mockSavedCommands.length = 0;

  // Setup sample templates
  const templates = [
    { action: "open_url", type: "OPEN_URL", url: "https://autocall.net/connect" },
    { action: "download_data", type: "DOWNLOAD_DATA", downloadSizeMb: 150 },
    { action: "return_to_autocall", type: "RETURN_TO_AUTOCALL" }
  ];

  // Test Case 1: Initial creation and starts on index 0
  console.log("Test Case 1: Creating and initiating a sequential collection...");
  const collection = await CommandCollectionService.createAndStartCollection(
    "Daily System Prep",
    "xy99z",
    templates,
    "60c72b2f9b1d8e256c8d1111"
  );

  assert.strictEqual(collection.name, "Daily System Prep");
  assert.strictEqual(collection.deviceUid, "xy99z");
  assert.strictEqual(collection.currentIndex, 0);
  assert.strictEqual(collection.status, "executing");
  assert.strictEqual(mockSavedCommands.length, 1);
  assert.strictEqual(mockSavedCommands[0].action, "open_url");
  assert.strictEqual(mockSavedCommands[0].status, "pending");
  assert.strictEqual(String(mockSavedCommands[0].collectionId), String(collection._id));
  assert.strictEqual(mockSavedCommands[0].collectionName, "Daily System Prep");
  assert.strictEqual(mockSavedCommands[0].collectionStepIndex, 0);
  assert.strictEqual(mockSavedCommands[0].collectionTotalSteps, 3);
  assert.strictEqual(String(collection.activeCommandIds[0]), String(mockSavedCommands[0]._id));
  console.log("✅ Passed: Collection and first command created successfully.\n");

  // Test Case 2: Advancement to step 2 after step 1 succeeds
  console.log("Test Case 2: Advancing to step 2 upon successful execution...");
  const firstCommandId = mockSavedCommands[0]._id;
  await CommandCollectionService.handleCommandStatusChange(firstCommandId, "executed");

  assert.strictEqual(collection.currentIndex, 1);
  assert.strictEqual(collection.status, "executing");
  assert.strictEqual(mockSavedCommands.length, 2);
  assert.strictEqual(mockSavedCommands[1].action, "download_data");
  assert.strictEqual(mockSavedCommands[1].status, "pending");
  assert.strictEqual(String(mockSavedCommands[1].collectionId), String(collection._id));
  assert.strictEqual(mockSavedCommands[1].collectionName, "Daily System Prep");
  assert.strictEqual(mockSavedCommands[1].collectionStepIndex, 1);
  assert.strictEqual(mockSavedCommands[1].collectionTotalSteps, 3);
  assert.strictEqual(String(collection.activeCommandIds[1]), String(mockSavedCommands[1]._id));
  console.log("✅ Passed: Collection advanced to index 1 and spawned download_data.\n");

  // Test Case 3: Halting on failure at step 2
  console.log("Test Case 3: Aborting sequence on step failure...");
  const secondCommandId = mockSavedCommands[1]._id;
  await CommandCollectionService.handleCommandStatusChange(secondCommandId, "failed", "Network Timeout");

  assert.strictEqual(collection.currentIndex, 1); // Remains at 1
  assert.strictEqual(collection.status, "failed"); // Collection failed
  assert.strictEqual(mockSavedCommands.length, 2); // No third command was created
  console.log("✅ Passed: Collection halted successfully and prevented Step 3 from being queued.\n");

  // Test Case 4: Complete run to success
  console.log("Test Case 4: Running a full successful collection sequence...");
  mockSavedCollections.length = 0;
  mockSavedCommands.length = 0;

  const successfulCollection = await CommandCollectionService.createAndStartCollection(
    "Full Success Run",
    "xy99z",
    templates,
    "60c72b2f9b1d8e256c8d1111"
  );

  // Step 1 Executes
  assert.strictEqual(successfulCollection.currentIndex, 0);
  let cmdId = mockSavedCommands[0]._id;
  await CommandCollectionService.handleCommandStatusChange(cmdId, "executed");

  // Step 2 Executes
  assert.strictEqual(successfulCollection.currentIndex, 1);
  cmdId = mockSavedCommands[1]._id;
  await CommandCollectionService.handleCommandStatusChange(cmdId, "executed");

  // Step 3 Executes
  assert.strictEqual(successfulCollection.currentIndex, 2);
  cmdId = mockSavedCommands[2]._id;
  await CommandCollectionService.handleCommandStatusChange(cmdId, "executed");

  // Check final status
  assert.strictEqual(successfulCollection.status, "executed");
  assert.notStrictEqual(successfulCollection.completedAt, null);
  assert.strictEqual(mockSavedCommands.length, 3);

  // Test Case 5: Delay metadata waits before the next command is queued
  console.log("Test Case 5: Applying delayAfterSeconds before dispatching the next command...");
  mockSavedCollections.length = 0;
  mockSavedCommands.length = 0;

  const delayedTemplates = [
    { action: "call", type: "CALL", phoneNumber: "+966500000000", delayAfterSeconds: 5 },
    { action: "sms", type: "SMS", phoneNumber: "+966500000000", message: "Done", delayAfterSeconds: 0 }
  ];

  let observedDelayMs = null;
  const originalSleep = CommandCollectionService.sleep;
  CommandCollectionService.sleep = async (ms) => {
    observedDelayMs = ms;
  };

  try {
    const delayedCollection = await CommandCollectionService.createAndStartCollection(
      "Delayed Follow Up",
      "xy99z",
      delayedTemplates,
      "60c72b2f9b1d8e256c8d1111"
    );

    assert.strictEqual(delayedCollection.commandTemplates[0].delayAfterSeconds, 5);
    assert.strictEqual(mockSavedCommands.length, 1);
    await CommandCollectionService.handleCommandStatusChange(mockSavedCommands[0]._id, "executed");

    assert.strictEqual(observedDelayMs, 5000);
    assert.strictEqual(delayedCollection.currentIndex, 1);
    assert.strictEqual(mockSavedCommands.length, 2);
    assert.strictEqual(mockSavedCommands[1].action, "sms");
  } finally {
    CommandCollectionService.sleep = originalSleep;
  }
  console.log("Passed: Delay was enforced before the next command was dispatched.\n");

  // Test Case 6: Invalid delay values are rejected
  console.log("Test Case 6: Rejecting invalid delayAfterSeconds values...");
  await assert.rejects(
    () => CommandCollectionService.createAndStartCollection(
      "Invalid Negative Delay",
      "xy99z",
      [{ action: "call", type: "CALL", phoneNumber: "+966500000000", delayAfterSeconds: -1 }],
      "60c72b2f9b1d8e256c8d1111"
    ),
    /delayAfterSeconds.*between 0 and 3600/
  );
  await assert.rejects(
    () => CommandCollectionService.createAndStartCollection(
      "Invalid Huge Delay",
      "xy99z",
      [{ action: "call", type: "CALL", phoneNumber: "+966500000000", delayAfterSeconds: 999999 }],
      "60c72b2f9b1d8e256c8d1111"
    ),
    /delayAfterSeconds.*between 0 and 3600/
  );
  console.log("Passed: Out-of-range delays were rejected.\n");
  console.log("✅ Passed: Full sequence completed perfectly.\n");

  console.log("🎉 All Command Collection Mock Tests passed with 100% success!");
}

runTests().catch(err => {
  console.error("❌ Test suite run failed:", err);
  process.exit(1);
});
