require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const { connectToDatabase } = require("./src/config/db");
const Device = require("./src/models/Device");
const Command = require("./src/models/Command");

const app = express();

process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ["text/plain"] }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });
  next();
});

const RIYADH_TIMEZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MINUTES = 3 * 60;
const DEVICE_NAME_MAX_LENGTH = 60;
const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);
const DEVICE_UID_FORMAT_ERROR = `deviceUid must be exactly ${DEVICE_UID_LENGTH} lowercase letters or digits`;
const COMMAND_FETCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const COMMAND_CLAIM_SORT = { isImmediate: -1, scheduledAt: 1, createdAt: 1, _id: 1 };

// Time strategy:
// 1) Storage format: UTC timestamps in MongoDB.
// 2) Response display format: Asia/Riyadh localized string for end users.
// 3) Parsing input format: datetime-local is interpreted as Riyadh local time, then converted to UTC.
function toUtcISOString(date = new Date()) {
  return new Date(date).toISOString();
}

function parseScheduledAtAsRiyadhToUtcDate(value) {
  if (!value || typeof value !== "string") return null;

  const hasExplicitTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
  if (hasExplicitTimezone) {
    return new Date(value);
  }

  // Expected from datetime-local: YYYY-MM-DDTHH:mm (optional :ss).
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return new Date(NaN);

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute) - RIYADH_UTC_OFFSET_MINUTES,
    Number(second)
  );

  return new Date(utcMillis);
}

function formatUtcForRiyadhDisplay(dateValue) {
  if (!dateValue) return null;
  return new Date(dateValue).toLocaleString("en-GB", {
    timeZone: RIYADH_TIMEZONE,
    hour12: false
  });
}

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

function normalizeDeviceName(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, DEVICE_NAME_MAX_LENGTH);
}

function parseRequestBodyObject(body) {
  if (!body) return {};

  if (typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function pickFirstDefinedValue(payload, keys) {
  if (!payload || typeof payload !== "object") return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function extractDeviceRegistrationInput(body) {
  const payload = parseRequestBodyObject(body);
  const nestedDevicePayload =
    payload.device && typeof payload.device === "object" ? payload.device : {};

  const rawDeviceUid = pickFirstDefinedValue(payload, [
    "deviceUid",
    "deviceUID",
    "uid",
    "deviceId",
    "id",
    "installationId"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "deviceUid",
    "deviceUID",
    "uid",
    "deviceId",
    "id",
    "installationId"
  ]);

  const rawDeviceName = pickFirstDefinedValue(payload, [
    "deviceName",
    "name",
    "device_name",
    "model"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "deviceName",
    "name",
    "device_name",
    "model"
  ]);

  const rawPlatform = pickFirstDefinedValue(payload, [
    "platform",
    "os",
    "osName"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "platform",
    "os",
    "osName"
  ]);

  return {
    payload,
    normalizedDeviceUid: normalizeDeviceUid(rawDeviceUid),
    normalizedDeviceName: normalizeDeviceName(rawDeviceName),
    normalizedPlatform: normalizeDeviceName(rawPlatform)
  };
}

function buildDefaultDeviceName(deviceUid) {
  const sanitized = String(deviceUid || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");
  return `Device-${sanitized}`;
}

function ensureDeviceName(device) {
  return normalizeDeviceName(device?.deviceName) ?? buildDefaultDeviceName(device?.deviceUid);
}

function toPlainObject(documentOrObject) {
  if (!documentOrObject) return documentOrObject;
  if (typeof documentOrObject.toObject === "function") {
    return documentOrObject.toObject();
  }
  return documentOrObject;
}

function mapDeviceForResponse(device) {
  const source = toPlainObject(device);

  return {
    deviceUid: source.deviceUid,
    deviceName: ensureDeviceName(source),
    platform: source.platform ?? null,
    online: Boolean(source.online),
    lastSeen: formatUtcForRiyadhDisplay(source.lastSeen)
  };
}

function mapCommandForResponse(command) {
  const source = toPlainObject(command);

  return {
    id: source._id ? String(source._id) : null,
    deviceUid: source.deviceUid,
    action: source.action,
    type: source.type,
    phoneNumber: source.phoneNumber ?? null,
    message: source.message ?? null,
    notes: source.notes ?? null,
    durationSeconds: source.durationSeconds ?? null,
    enabled: source.enabled ?? null,
    autoHangupSeconds: source.autoHangupSeconds ?? null,
    status: source.status,
    failureReason: source.failureReason ?? null,
    scheduledAt: formatUtcForRiyadhDisplay(source.scheduledAt),
    isImmediate:
      typeof source.isImmediate === "boolean"
        ? source.isImmediate
        : !source.scheduledAt,
    createdAt: formatUtcForRiyadhDisplay(source.createdAt),
    executedAt: formatUtcForRiyadhDisplay(source.executedAt)
  };
}

function nowIsoTimestamp() {
  return new Date(toUtcISOString()).toISOString();
}

function commandIdFrom(commandOrObject) {
  const source = toPlainObject(commandOrObject);
  if (!source) return null;
  return source._id ? String(source._id) : null;
}

function getCommandFetchCutoffDate() {
  return new Date(Date.now() - COMMAND_FETCH_WINDOW_MS);
}

function buildDuePendingCommandFilter(deviceUid) {
  return {
    deviceUid,
    status: "pending",
    createdAt: { $gte: getCommandFetchCutoffDate() },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date(toUtcISOString()) } }]
  };
}

function logCommandLifecycle(eventName, payload = {}) {
  console.log("[CommandLifecycle]", {
    event: eventName,
    timestamp: nowIsoTimestamp(),
    commandId: payload.commandId ?? null,
    deviceUid: payload.deviceUid ?? null,
    oldStatus: payload.oldStatus ?? null,
    newStatus: payload.newStatus ?? null,
    count: payload.count ?? null,
    ids: payload.ids ?? null,
    details: payload.details ?? null
  });
}

function handleServerError(res, error, contextLabel) {
  console.error(`[${contextLabel}]`, error);
  return res.status(500).json({ error: "Internal server error" });
}

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  return res.status(200).json({ ok: true });
});

// =====================
// Register device
// =====================
app.post("/devices/register", async (req, res) => {
  try {
    const { payload, normalizedDeviceUid, normalizedDeviceName, normalizedPlatform } =
      extractDeviceRegistrationInput(req.body);
    const requestInfo = {
      contentType: req.headers["content-type"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      keys: Object.keys(payload || {}),
      body: payload
    };
    console.log("[DeviceRegister] Incoming request:", requestInfo);

    if (!normalizedDeviceUid) {
      console.warn("[DeviceRegister] Validation failed: deviceUid is missing/empty", requestInfo);
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const now = new Date(toUtcISOString());
    let device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    const wasExisting = Boolean(device);

    if (!device) {
      device = new Device({
        deviceUid: normalizedDeviceUid,
        deviceName: normalizedDeviceName ?? buildDefaultDeviceName(normalizedDeviceUid),
        platform: normalizedPlatform,
        online: true,
        lastSeen: now
      });
    } else {
      device.online = true;
      device.lastSeen = now;

      if (normalizedDeviceName) {
        device.deviceName = normalizedDeviceName;
      } else if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }

      if (normalizedPlatform) {
        device.platform = normalizedPlatform;
      }
    }

    try {
      await device.save();
    } catch (error) {
      // Handles rare race condition when two register requests arrive simultaneously.
      if (error?.code === 11000) {
        console.warn("[DeviceRegister] Duplicate deviceUid on save, retrying as update:", {
          deviceUid: normalizedDeviceUid,
          error: error.message
        });

        const existingDevice = await Device.findOne({ deviceUid: normalizedDeviceUid });
        if (!existingDevice) {
          throw error;
        }

        existingDevice.online = true;
        existingDevice.lastSeen = now;
        if (normalizedDeviceName) {
          existingDevice.deviceName = normalizedDeviceName;
        } else if (!normalizeDeviceName(existingDevice.deviceName)) {
          existingDevice.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
        }
        if (normalizedPlatform) {
          existingDevice.platform = normalizedPlatform;
        }

        await existingDevice.save();
        device = existingDevice;
      } else {
        throw error;
      }
    }

    console.log("[DeviceRegister] Registration success:", {
      deviceUid: normalizedDeviceUid,
      mode: wasExisting ? "updated_existing" : "created_new",
      platform: device.platform ?? null
    });

    return res.json({ success: true, device: mapDeviceForResponse(device) });
  } catch (error) {
    console.error("[DeviceRegister] Registration failed:", {
      error: error?.message,
      stack: error?.stack
    });
    return handleServerError(res, error, "POST /devices/register");
  }
});

// =====================
// Heartbeat
// =====================
app.post("/devices/heartbeat", async (req, res) => {
  try {
    const { payload, normalizedDeviceUid } = extractDeviceRegistrationInput(req.body);
    console.log("[DeviceHeartbeat] Incoming request:", {
      contentType: req.headers["content-type"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      keys: Object.keys(payload || {}),
      body: payload
    });

    if (!normalizedDeviceUid) {
      console.warn("[DeviceHeartbeat] Validation failed: deviceUid is missing/empty");
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });

    if (device) {
      device.online = true;
      device.lastSeen = new Date(toUtcISOString());

      if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }

      await device.save();
      console.log("[DeviceHeartbeat] Updated existing device:", {
        deviceUid: normalizedDeviceUid
      });
    } else {
      console.warn("[DeviceHeartbeat] Device not found, heartbeat ignored:", {
        deviceUid: normalizedDeviceUid
      });
    }

    return res.json({
      success: true,
      device: device ? mapDeviceForResponse(device) : null
    });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/heartbeat");
  }
});

// =====================
// Get devices
// =====================
app.get("/devices", async (req, res) => {
  try {
    const devices = await Device.find({ deviceUid: { $regex: DEVICE_UID_REGEX } });
    return res.json(devices.map(mapDeviceForResponse));
  } catch (error) {
    return handleServerError(res, error, "GET /devices");
  }
});

app.delete("/devices/:deviceUid", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.params?.deviceUid);

    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const deletedDevice = await Device.findOneAndDelete({
      deviceUid: normalizedDeviceUid
    });

    if (!deletedDevice) {
      return res.status(404).json({ error: "Device not found" });
    }

    return res.json({
      success: true,
      message: "Device deleted",
      device: mapDeviceForResponse(deletedDevice)
    });
  } catch (error) {
    return handleServerError(res, error, "DELETE /devices/:deviceUid");
  }
});

app.post("/devices/rename", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.body?.deviceUid);
    const normalizedDeviceName = normalizeDeviceName(req.body?.deviceName);

    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }
    if (!normalizedDeviceName) {
      return res.status(400).json({ error: "deviceName is required" });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    device.deviceName = normalizedDeviceName;
    await device.save();

    return res.json({ success: true, device: mapDeviceForResponse(device) });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/rename");
  }
});

// =====================
// Create command
// =====================
app.post("/commands", async (req, res) => {
  try {
    const {
      deviceUid,
      action,
      type,
      phoneNumber,
      message,
      notes,
      scheduledAt,
      durationSeconds,
      enabled,
      autoHangupSeconds
    } = req.body;

    const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    let scheduledAtDate = null;
    const actionToType = {
      call: "CALL",
      end: "END",
      sms: "SMS",
      auto_answer: "AUTO_ANSWER"
    };
    const typeToAction = {
      CALL: "call",
      END: "end",
      SMS: "sms",
      AUTO_ANSWER: "auto_answer"
    };

    const normalizedActionInput =
      typeof action === "string" && action.trim()
        ? action.trim().toLowerCase()
        : null;
    const normalizedTypeInput =
      typeof type === "string" && type.trim()
        ? type.trim().toUpperCase()
        : null;

    if (normalizedActionInput && !actionToType[normalizedActionInput]) {
      return res.status(400).json({
        error: "Invalid action. Only 'call', 'end', 'sms', and 'auto_answer' are supported."
      });
    }

    if (normalizedTypeInput && !typeToAction[normalizedTypeInput]) {
      return res.status(400).json({
        error: "Invalid type. Only 'CALL', 'END', 'SMS', and 'AUTO_ANSWER' are supported."
      });
    }

    if (
      normalizedActionInput &&
      normalizedTypeInput &&
      actionToType[normalizedActionInput] !== normalizedTypeInput
    ) {
      return res.status(400).json({
        error: "action and type mismatch"
      });
    }

    const normalizedAction =
      normalizedActionInput ?? typeToAction[normalizedTypeInput] ?? "call";
    const commandType = normalizedTypeInput ?? actionToType[normalizedAction];
    const isAutoAnswerCommand = normalizedAction === "auto_answer";

    const normalizedPhoneNumber =
      typeof phoneNumber === "string" ? phoneNumber.trim() : "";
    const requiresPhoneNumber =
      normalizedAction === "call" || normalizedAction === "sms";
    if (requiresPhoneNumber && !normalizedPhoneNumber) {
      return res.status(400).json({
        error: "phoneNumber is required for CALL and SMS commands"
      });
    }

    if (isAutoAnswerCommand && normalizedPhoneNumber) {
      return res.status(400).json({
        error: "phoneNumber is not supported for AUTO_ANSWER commands"
      });
    }

    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    if (normalizedAction === "sms" && !normalizedMessage) {
      return res.status(400).json({
        error: "message is required for SMS commands"
      });
    }

    if (isAutoAnswerCommand && normalizedMessage) {
      return res.status(400).json({
        error: "message is not supported for AUTO_ANSWER commands"
      });
    }

    const normalizedNotes =
      typeof notes === "string" && notes.trim() ? notes.trim() : null;

    let normalizedDurationSeconds = null;
    if (
      normalizedAction === "call" &&
      durationSeconds !== undefined &&
      durationSeconds !== null
    ) {
      const parsedDuration = Number(durationSeconds);
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        return res
          .status(400)
          .json({ error: "durationSeconds must be a number greater than 0" });
      }
      normalizedDurationSeconds = parsedDuration;
    }

    if (
      normalizedAction !== "call" &&
      durationSeconds !== undefined &&
      durationSeconds !== null
    ) {
      return res.status(400).json({
        error: "durationSeconds is only supported for CALL commands"
      });
    }

    let normalizedEnabled = null;
    let normalizedAutoHangupSeconds = null;
    if (isAutoAnswerCommand) {
      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          error: "enabled is required and must be a boolean for AUTO_ANSWER commands"
        });
      }

      normalizedEnabled = enabled;
      if (
        enabled === true &&
        autoHangupSeconds !== undefined &&
        autoHangupSeconds !== null
      ) {
        const parsedAutoHangupSeconds = Number(autoHangupSeconds);
        if (!Number.isFinite(parsedAutoHangupSeconds) || parsedAutoHangupSeconds <= 0) {
          return res.status(400).json({
            error: "autoHangupSeconds must be a number greater than 0"
          });
        }

        normalizedAutoHangupSeconds = Math.max(
          1,
          Math.min(600, Math.round(parsedAutoHangupSeconds))
        );
      }
    } else {
      if (enabled !== undefined && enabled !== null) {
        return res.status(400).json({
          error: "enabled is only supported for AUTO_ANSWER commands"
        });
      }
      if (autoHangupSeconds !== undefined && autoHangupSeconds !== null) {
        return res.status(400).json({
          error: "autoHangupSeconds is only supported for AUTO_ANSWER commands"
        });
      }
    }

    if (scheduledAt) {
      const parsedDate = parseScheduledAtAsRiyadhToUtcDate(scheduledAt);
      const parsedTime = parsedDate.getTime();

      if (Number.isNaN(parsedTime)) {
        return res.status(400).json({ error: "Invalid scheduledAt date" });
      }

      const now = Date.now();
      const diff = parsedTime - now;

      if (diff < -60000) {
        return res.status(400).json({ error: "scheduledAt is too far in the past" });
      }

      if (diff > 0) {
        scheduledAtDate = parsedDate;
      }
    }

    const command = await Command.create({
      deviceUid: normalizedDeviceUid,
      action: normalizedAction,
      type: commandType,
      phoneNumber: requiresPhoneNumber ? normalizedPhoneNumber : null,
      message: normalizedAction === "sms" ? normalizedMessage : null,
      notes: normalizedNotes,
      durationSeconds: normalizedAction === "call" ? normalizedDurationSeconds : null,
      enabled: isAutoAnswerCommand ? normalizedEnabled : null,
      autoHangupSeconds:
        isAutoAnswerCommand && normalizedEnabled === true
          ? normalizedAutoHangupSeconds
          : null,
      status: "pending",
      failureReason: null,
      scheduledAt: scheduledAtDate,
      isImmediate: scheduledAtDate === null,
      createdAt: new Date(toUtcISOString())
    });

    logCommandLifecycle("created", {
      commandId: commandIdFrom(command),
      deviceUid: normalizedDeviceUid,
      oldStatus: null,
      newStatus: "pending",
      details: {
        action: normalizedAction,
        type: commandType,
        scheduledAt: scheduledAtDate ? scheduledAtDate.toISOString() : null
      }
    });

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands");
  }
});

// =====================
// Claim next command (atomic pending -> executing)
// =====================
app.post("/commands/claim", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.body?.deviceUid);
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const claimFilter = buildDuePendingCommandFilter(normalizedDeviceUid);
    const claimedCommand = await Command.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: "executing",
          failureReason: null,
          executedAt: null
        }
      },
      {
        sort: COMMAND_CLAIM_SORT,
        new: true
      }
    );

    if (!claimedCommand) {
      logCommandLifecycle("claim_none", {
        deviceUid: normalizedDeviceUid,
        oldStatus: "pending",
        newStatus: null
      });
      return res.json({ success: true, command: null });
    }

    logCommandLifecycle("claimed", {
      commandId: commandIdFrom(claimedCommand),
      deviceUid: normalizedDeviceUid,
      oldStatus: "pending",
      newStatus: "executing",
      details: {
        action: claimedCommand.action,
        type: claimedCommand.type
      }
    });

    return res.json({
      success: true,
      command: mapCommandForResponse(claimedCommand)
    });
  } catch (error) {
    return handleServerError(res, error, "POST /commands/claim");
  }
});

// =====================
// Get commands
// =====================
app.get("/commands", async (req, res) => {
  try {
    const { deviceUid, status } = req.query;

    const last24HoursCutoff = getCommandFetchCutoffDate();
    const filter = {};
    if (deviceUid) {
      const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
      if (!normalizedDeviceUid) {
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }
      filter.deviceUid = normalizedDeviceUid;
    } else {
      filter.deviceUid = { $regex: DEVICE_UID_REGEX };
    }

    if (status) {
      filter.status = status;
    }

    filter.createdAt = { $gte: last24HoursCutoff };

    const result = await Command.find(filter);

    const sortedResult = [...result].sort((a, b) => {
      const aImmediate = !a.scheduledAt;
      const bImmediate = !b.scheduledAt;

      if (aImmediate && !bImmediate) return -1;
      if (!aImmediate && bImmediate) return 1;
      if (aImmediate && bImmediate) return 0;

      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    logCommandLifecycle("fetched", {
      deviceUid: typeof filter.deviceUid === "string" ? filter.deviceUid : null,
      oldStatus: null,
      newStatus: status ?? null,
      count: sortedResult.length,
      ids: sortedResult.map((command) => commandIdFrom(command))
    });

    return res.json(sortedResult.map(mapCommandForResponse));
  } catch (error) {
    return handleServerError(res, error, "GET /commands");
  }
});

app.delete("/commands", async (req, res) => {
  try {
    await Command.deleteMany({});
    return res.json({
      success: true,
      message: "All commands cleared"
    });
  } catch (error) {
    return handleServerError(res, error, "DELETE /commands");
  }
});

// =====================
// Update command status
// =====================
app.post("/commands/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, failureReason } = req.body;

    const command = mongoose.isValidObjectId(id)
      ? await Command.findById(id)
      : null;

    if (!command) {
      logCommandLifecycle("status_update_missing_command", {
        commandId: id,
        oldStatus: null,
        newStatus: status ?? null
      });
      return res.status(404).json({ error: "Command not found" });
    }

    const normalizedStatus =
      typeof status === "string" ? status.trim().toLowerCase() : "";
    const validStatuses = new Set(["pending", "executing", "executed", "failed"]);

    if (!validStatuses.has(normalizedStatus)) {
      return res.status(400).json({
        error: "Invalid status. Only 'pending', 'executing', 'executed', and 'failed' are supported."
      });
    }

    const allowedTransitions = {
      pending: new Set(["pending", "executing", "executed", "failed"]),
      executing: new Set(["executing", "executed", "failed"]),
      executed: new Set(["executed"]),
      failed: new Set(["failed"])
    };

    const canTransition = allowedTransitions[command.status]?.has(normalizedStatus);
    if (!canTransition) {
      logCommandLifecycle("status_transition_ignored", {
        commandId: commandIdFrom(command),
        deviceUid: command.deviceUid,
        oldStatus: command.status,
        newStatus: normalizedStatus
      });
      return res.json(mapCommandForResponse(command));
    }

    const previousStatus = command.status;
    command.status = normalizedStatus;

    if (normalizedStatus === "executed") {
      command.executedAt = new Date(toUtcISOString());
      command.failureReason = null;
    } else if (normalizedStatus === "failed") {
      command.failureReason =
        typeof failureReason === "string" && failureReason.trim()
          ? failureReason.trim()
          : "Command execution failed";
    } else {
      command.failureReason = null;
    }

    await command.save();

    logCommandLifecycle("status_updated", {
      commandId: commandIdFrom(command),
      deviceUid: command.deviceUid,
      oldStatus: previousStatus,
      newStatus: normalizedStatus,
      details: {
        failureReason:
          normalizedStatus === "failed"
            ? command.failureReason ?? null
            : null
      }
    });

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands/:id/status");
  }
});

app.use(express.static("public"));
app.use((error, req, res, next) => {
  console.error("[ExpressError]", error);
  if (res.headersSent) {
    return next(error);
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const statusCode = Number(error?.status || error?.statusCode) || 500;
  return res.status(statusCode).json({ error: statusCode >= 500 ? "Internal server error" : error.message });
});

const PORT = Number(process.env.PORT) || 4000;

async function cleanupLegacyDeviceUidData() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const invalidUidFilter = { deviceUid: { $not: DEVICE_UID_REGEX } };
  const [devicesCleanupResult, commandsCleanupResult] = await Promise.all([
    Device.deleteMany(invalidUidFilter),
    Command.deleteMany(invalidUidFilter)
  ]);

  const deletedDevices = Number(devicesCleanupResult?.deletedCount || 0);
  const deletedCommands = Number(commandsCleanupResult?.deletedCount || 0);
  if (deletedDevices > 0 || deletedCommands > 0) {
    console.warn("[DeviceUidCleanup] Removed legacy rows with invalid deviceUid:", {
      deletedDevices,
      deletedCommands
    });
  }
}

async function startServer() {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  await connectToDatabase();
  await cleanupLegacyDeviceUidData();
}

startServer();
