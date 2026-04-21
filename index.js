require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const { connectToDatabase } = require("./src/config/db");
const Device = require("./src/models/Device");
const Command = require("./src/models/Command");

const app = express();
app.use(cors());
app.use(express.json());

const RIYADH_TIMEZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MINUTES = 3 * 60;
const DEVICE_NAME_MAX_LENGTH = 60;

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
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeDeviceName(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, DEVICE_NAME_MAX_LENGTH);
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

function handleServerError(res, error, contextLabel) {
  console.error(`[${contextLabel}]`, error);
  return res.status(500).json({ error: "Internal server error" });
}

// =====================
// Register device
// =====================
app.post("/devices/register", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.body?.deviceUid);
    const normalizedDeviceName = normalizeDeviceName(req.body?.deviceName);

    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: "deviceUid is required" });
    }

    let device = await Device.findOne({ deviceUid: normalizedDeviceUid });

    if (!device) {
      device = new Device({
        deviceUid: normalizedDeviceUid,
        deviceName: normalizedDeviceName ?? buildDefaultDeviceName(normalizedDeviceUid),
        online: true,
        lastSeen: new Date(toUtcISOString())
      });
    } else {
      device.online = true;
      device.lastSeen = new Date(toUtcISOString());

      if (normalizedDeviceName) {
        device.deviceName = normalizedDeviceName;
      } else if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }
    }

    await device.save();

    return res.json({ success: true, device: mapDeviceForResponse(device) });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/register");
  }
});

// =====================
// Heartbeat
// =====================
app.post("/devices/heartbeat", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.body?.deviceUid);

    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: "deviceUid is required" });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });

    if (device) {
      device.online = true;
      device.lastSeen = new Date(toUtcISOString());

      if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }

      await device.save();
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
    const devices = await Device.find({});
    return res.json(devices.map(mapDeviceForResponse));
  } catch (error) {
    return handleServerError(res, error, "GET /devices");
  }
});

app.delete("/devices/:deviceUid", async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.params?.deviceUid);

    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: "deviceUid is required" });
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
      return res.status(400).json({ error: "deviceUid is required" });
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
      return res.status(400).json({ error: "deviceUid is required" });
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

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands");
  }
});

// =====================
// Get commands
// =====================
app.get("/commands", async (req, res) => {
  try {
    const { deviceUid, status } = req.query;

    const filter = {};
    if (deviceUid) {
      filter.deviceUid = deviceUid;
    }

    if (status) {
      filter.status = status;
    }

    const result = await Command.find(filter);

    const sortedResult = [...result].sort((a, b) => {
      const aImmediate = !a.scheduledAt;
      const bImmediate = !b.scheduledAt;

      if (aImmediate && !bImmediate) return -1;
      if (!aImmediate && bImmediate) return 1;
      if (aImmediate && bImmediate) return 0;

      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
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
      return res.json(mapCommandForResponse(command));
    }

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

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands/:id/status");
  }
});

app.use(express.static("public"));

const PORT = Number(process.env.PORT) || 4000;

async function startServer() {
  try {
    await connectToDatabase();

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
