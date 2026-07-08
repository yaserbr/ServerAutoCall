const mongoose = require("mongoose");
const Command = require("../models/Command");
const Device = require("../models/Device");
const CommandCollection = require("../models/CommandCollection");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const MAX_DELAY_AFTER_SECONDS = 3600;

function createValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

class CommandCollectionService {
  static io = null;
  static mapCommandForResponse = null;
  static sleep = sleep;

  /**
   * Initializes the service with Socket.io and response mapper callback.
   * Called once during server startup in startServer() inside index.js.
   */
  static initialize(io, mapCommandForResponse) {
    this.io = io;
    this.mapCommandForResponse = mapCommandForResponse;
    console.log("[CommandCollection Service] Successfully initialized with WebSockets and Command Mapper.");
  }

  static normalizeDelayAfterSeconds(value, templateIndex) {
    if (value === undefined || value === null || value === "") {
      return 0;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw createValidationError(`delayAfterSeconds for command template at index ${templateIndex} must be a number.`);
    }

    if (value < 0 || value > MAX_DELAY_AFTER_SECONDS) {
      throw createValidationError(`delayAfterSeconds for command template at index ${templateIndex} must be between 0 and ${MAX_DELAY_AFTER_SECONDS}.`);
    }

    return value;
  }

  /**
   * Creates a new Command Collection, saves it, and queues the first command.
   */
  static async createAndStartCollection(name, deviceUid, templates, ownerUserId = null) {
    console.log(`[CommandCollection Service] Creating new collection: '${name}' for Device: ${deviceUid}`);

    if (!name || typeof name !== "string" || !name.trim()) {
      throw new Error("Collection name is required.");
    }

    if (!deviceUid || typeof deviceUid !== "string" || deviceUid.trim().length !== 5) {
      throw new Error("Device UID must be exactly 5 characters.");
    }

    const normalizedDeviceUid = deviceUid.trim().toLowerCase();

    // Verify the target device exists
    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!device) {
      throw new Error(`Device with UID '${normalizedDeviceUid}' was not found.`);
    }

    if (!Array.isArray(templates) || templates.length === 0) {
      throw new Error("A command collection must contain at least one command template.");
    }

    const processedTemplates = templates.map((tmpl, idx) => {
      if (!tmpl.action) {
        throw new Error(`Command template at index ${idx} is missing 'action' field.`);
      }
      const action = String(tmpl.action).trim().toLowerCase();
      const type = tmpl.type ? String(tmpl.type).trim().toUpperCase() : action.toUpperCase();
      const delayAfterSeconds = this.normalizeDelayAfterSeconds(tmpl.delayAfterSeconds, idx);

      return {
        ...tmpl,
        action,
        type,
        delayAfterSeconds
      };
    });

    const collection = new CommandCollection({
      name: name.trim(),
      deviceUid: normalizedDeviceUid,
      ownerUserId,
      commandTemplates: processedTemplates,
      activeCommandIds: new Array(processedTemplates.length).fill(null),
      status: "pending",
      currentIndex: 0
    });

    await collection.save();
    console.log(`[CommandCollection Service] Saved collection metadata: ${collection._id}`);

    // Fire the initial command in the sequence
    await this.queueNextCommand(collection);

    return collection;
  }

  /**
   * Instantiates and schedules the command at the current active index.
   * Creates a separate MongoDB Command document and broadcasts it over WebSockets.
   */
  static async queueNextCommand(collection) {
    const idx = collection.currentIndex;
    console.log(`[CommandCollection Service] Queueing step ${idx + 1}/${collection.commandTemplates.length} for Collection: '${collection.name}'`);

    if (idx >= collection.commandTemplates.length) {
      throw new Error(`Index ${idx} is out of bounds for collection length ${collection.commandTemplates.length}`);
    }

    const template = collection.commandTemplates[idx];

    // Create a separate, distinct physical Command document in the database
    const command = new Command({
      deviceUid: collection.deviceUid,
      action: template.action,
      type: template.type,
      phoneNumber: template.phoneNumber || undefined,
      message: template.message || undefined,
      url: template.url || undefined,
      appName: template.appName || undefined,
      resolvedPackageName: template.resolvedPackageName || undefined,
      notes: template.notes || `Step ${idx + 1} of collection: ${collection.name}`,
      durationSeconds: template.durationSeconds || undefined,
      downloadSizeMb: template.downloadSizeMb || undefined,
      downloadDurationSeconds: template.downloadDurationSeconds || undefined,
      enabled: template.enabled !== undefined && template.enabled !== null ? template.enabled : undefined,
      autoHangupSeconds: template.autoHangupSeconds || undefined,
      collectionId: collection._id,
      collectionName: collection.name,
      collectionStepIndex: idx,
      collectionTotalSteps: collection.commandTemplates.length,
      status: "pending",
      isImmediate: true
    });

    await command.save();
    console.log(`[CommandCollection Service] Distinct Command document created in DB: ${command._id}`);

    // Map this live command ID back to our collection
    collection.activeCommandIds[idx] = command._id;
    
    // Explicitly notify Mongoose that the array has been mutated (Dirty Checking Fix)
    collection.markModified("activeCommandIds");
    collection.status = "executing";

    await collection.save();
    console.log(`[CommandCollection Service] Mapped Command ${command._id} to Collection slot index ${idx}. Collection status: 'executing'`);

    // Broadcast the new command immediately over WebSockets to wake up device handlers!
    if (this.io && this.mapCommandForResponse) {
      try {
        const formattedCommand = this.mapCommandForResponse(command);
        this.io.to(`device:${collection.deviceUid}`).emit("command:new", formattedCommand);
        this.io.to(`dashboard:${collection.deviceUid}`).emit("command:created", formattedCommand);
        console.log(`[CommandCollection Service] WebSockets Emitted: Sent 'command:new' and 'command:created' to rooms 'device:${collection.deviceUid}' & 'dashboard:${collection.deviceUid}'`);
      } catch (socketError) {
        console.error(`[CommandCollection Service] ERROR broadcasting socket events:`, socketError);
      }
    } else {
      console.warn(`[CommandCollection Service] WebSockets omitted: Sockets or Mapper not initialized.`);
    }
  }

  /**
   * Listens for command status updates and handles sequence advancement or halting.
   */
  static async handleCommandStatusChange(commandId, newStatus, failureReason = "") {
    console.log(`\n[CommandCollection Service] === handleCommandStatusChange TRIGGERED ===`);
    console.log(`[CommandCollection Service] - Incoming Command ID: ${commandId}`);
    console.log(`[CommandCollection Service] - Reported Status: ${newStatus}`);
    console.log(`[CommandCollection Service] - Failure Reason (if any): ${failureReason || "N/A"}`);

    if (!commandId) {
      console.error(`[CommandCollection Service] ERROR: Missing commandId in status change hook.`);
      return;
    }

    const normalizedStatus = String(newStatus).trim().toLowerCase();
    if (!["executed", "failed"].includes(normalizedStatus)) {
      console.warn(`[CommandCollection Service] Invalid/non-terminal status callback ignored for collection progression.`, {
        commandId,
        status: normalizedStatus
      });
      return;
    }

    try {
      // Find the physical Command document first to retrieve its deviceUid reliably
      const command = await Command.findById(commandId);
      if (!command) {
        console.log(`[CommandCollection Service] Result: Command with ID ${commandId} not found in DB. Skip.`);
        return;
      }

      console.log(`[CommandCollection Service] Command found. Target deviceUid: ${command.deviceUid}`);
      console.log(`[CommandCollection Service] Querying MongoDB for executing collections running on target device: ${command.deviceUid}`);
      
      // Query by indexed fields: deviceUid and status
      const collections = await CommandCollection.find({
        deviceUid: command.deviceUid,
        status: "executing"
      });

      if (!collections || collections.length === 0) {
        console.warn(`[CommandCollection Service] Potentially stuck status callback: no executing collections found for deviceUid: ${command.deviceUid}`, {
          commandId,
          status: normalizedStatus
        });
        return;
      }

      // 100% BULLETPROOF MANUAL MATCHING: Bypass all Mongoose schema-level casting filters
      // Matches regardless of whether the array elements are stored as native ObjectIds or plain strings!
      const collection = collections.find(col => {
        return col.activeCommandIds && col.activeCommandIds.some(id => id && String(id) === String(commandId));
      });

      if (!collection) {
        console.warn(`[CommandCollection Service] Potentially stuck status callback: no executing collection contains Command ID.`, {
          commandId,
          deviceUid: command.deviceUid,
          executingCollectionCount: collections.length
        });
        return;
      }

      console.log(`[CommandCollection Service] SUCCESS: Found matching executing collection: '${collection.name}' (ID: ${collection._id})`);

      const idx = collection.currentIndex;
      const expectedCommandId = collection.activeCommandIds[idx];

      console.log(`[CommandCollection Service] Collection Current Index: ${idx}`);
      console.log(`[CommandCollection Service] Expected Command ID at index ${idx}: ${expectedCommandId}`);

      // Robust string-based comparison to prevent Object vs String mismatch
      if (!expectedCommandId || String(expectedCommandId) !== String(commandId)) {
        console.warn(`[CommandCollection Service] WARNING: Received command ID ${commandId} does not match expected active step ID ${expectedCommandId}. Skipping.`);
        return;
      }

      if (normalizedStatus === "executed") {
        console.log(`[CommandCollection Service] Success status confirmed for step ${idx + 1}/${collection.commandTemplates.length}.`);
        
        if (idx + 1 >= collection.commandTemplates.length) {
          console.log(`[CommandCollection Service] ALL STEPS COMPLETED! Updating collection status to 'executed'`);
          collection.status = "executed";
          collection.completedAt = new Date();
          await collection.save();
          console.log(`[CommandCollection Service] Collection '${collection.name}' executed all steps successfully!`);
        } else {
          const completedTemplate = collection.commandTemplates[idx] || {};
          const delayAfterSeconds = this.normalizeDelayAfterSeconds(completedTemplate.delayAfterSeconds, idx);
          console.log(`[CommandCollection Service] Delay configured after step ${idx + 1}/${collection.commandTemplates.length}: ${delayAfterSeconds}s`);
          console.log(`[CommandCollection Service] Progressing sequence. Incrementing currentIndex from ${idx} to ${idx + 1}`);
          collection.currentIndex += 1;
          await collection.save();
          
          console.log(`[CommandCollection Service] Collection advancing to next step. Triggering queueNextCommand...`, {
            collectionId: String(collection._id),
            collectionName: collection.name,
            nextStepIndex: collection.currentIndex,
            totalSteps: collection.commandTemplates.length,
            delayAfterSeconds
          });
          if (delayAfterSeconds > 0) {
            console.log(`[CommandCollection Service] Waiting ${delayAfterSeconds}s before dispatching next collection command.`);
            await this.sleep(delayAfterSeconds * 1000);
          } else {
            console.log(`[CommandCollection Service] No delay configured; dispatching next collection command immediately.`);
          }
          await this.queueNextCommand(collection);
          console.log(`[CommandCollection Service] Next command dispatched after delay.`, {
            collectionId: String(collection._id),
            collectionName: collection.name,
            dispatchedStepIndex: collection.currentIndex,
            delayAfterSeconds
          });
        }
      } else if (normalizedStatus === "failed") {
        console.error(`[CommandCollection Service] HALTING SEQUENCE: Step ${idx + 1} reported failure. Reason: ${failureReason || "N/A"}`);
        collection.status = "failed";
        await collection.save();
        console.log(`[CommandCollection Service] Collection '${collection.name}' halted successfully.`);
      }
    } catch (err) {
      console.error(`[CommandCollection Service] CRITICAL EXCEPTION inside handleCommandStatusChange:`, err);
    }
  }
}

module.exports = CommandCollectionService;
