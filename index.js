const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 تخزين مؤقت (in-memory)
const devices = [];
const commands = [];

const RIYADH_TIMEZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MINUTES = 3 * 60;

// Time strategy:
// 1) Storage format: UTC ISO strings only (toISOString).
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

function mapDeviceForResponse(device) {
  return {
    ...device,
    lastSeen: formatUtcForRiyadhDisplay(device.lastSeen)
  };
}

function mapCommandForResponse(command) {
  return {
    ...command,
    createdAt: formatUtcForRiyadhDisplay(command.createdAt),
    executedAt: formatUtcForRiyadhDisplay(command.executedAt),
    scheduledAt: formatUtcForRiyadhDisplay(command.scheduledAt)
  };
}

// =====================
// تسجيل جهاز
// =====================
app.post("/devices/register", (req, res) => {
  const { deviceUid } = req.body;

  let device = devices.find(d => d.deviceUid === deviceUid);

  if (!device) {
    device = {
      deviceUid,
      online: true,
      lastSeen: toUtcISOString()
    };
    devices.push(device);
  } else {
    device.online = true;
    device.lastSeen = toUtcISOString();
  }

  res.json({ success: true, device: mapDeviceForResponse(device) });
});

// =====================
// heartbeat
// =====================
app.post("/devices/heartbeat", (req, res) => {
  const { deviceUid } = req.body;

  const device = devices.find(d => d.deviceUid === deviceUid);

  if (device) {
    device.online = true;
    device.lastSeen = toUtcISOString();
  }

  res.json({ success: true });
});

// =====================
// جلب الأجهزة
// =====================
app.get("/devices", (req, res) => {
  res.json(devices.map(mapDeviceForResponse));
});

// =====================
// إنشاء أمر اتصال
// =====================
app.post("/commands", (req, res) => {
  const {
    deviceUid,
    action,
    type,
    phoneNumber,
    message,
    scheduledAt,
    durationSeconds,
    enabled,
    autoHangupSeconds
  } = req.body;
  let scheduledAtIso = null;
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

  const normalizedAction = normalizedActionInput ?? typeToAction[normalizedTypeInput] ?? "call";
  const commandType = normalizedTypeInput ?? actionToType[normalizedAction];
  const isAutoAnswerCommand = normalizedAction === "auto_answer";

  const normalizedPhoneNumber =
    typeof phoneNumber === "string" ? phoneNumber.trim() : "";
  const requiresPhoneNumber = normalizedAction === "call" || normalizedAction === "sms";
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

  let normalizedDurationSeconds = null;
  if (normalizedAction === "call" && durationSeconds !== undefined && durationSeconds !== null) {
    const parsedDuration = Number(durationSeconds);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({ error: "durationSeconds must be a number greater than 0" });
    }
    normalizedDurationSeconds = parsedDuration;
  }

  if (normalizedAction !== "call" && durationSeconds !== undefined && durationSeconds !== null) {
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
    if (enabled === true && autoHangupSeconds !== undefined && autoHangupSeconds !== null) {
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
      scheduledAtIso = toUtcISOString(parsedDate);
    }
  }

  const command = {
    id: Date.now().toString(),
    deviceUid,
    action: normalizedAction,
    type: commandType,
    phoneNumber: requiresPhoneNumber ? normalizedPhoneNumber : null,
    message: normalizedAction === "sms" ? normalizedMessage : null,
    durationSeconds: normalizedAction === "call" ? normalizedDurationSeconds : null,
    enabled: isAutoAnswerCommand ? normalizedEnabled : null,
    autoHangupSeconds:
      isAutoAnswerCommand && normalizedEnabled === true
        ? normalizedAutoHangupSeconds
        : null,
    status: "pending",
    failureReason: null,
    scheduledAt: scheduledAtIso,
    isImmediate: scheduledAtIso === null,
    createdAt: toUtcISOString()
  };

  commands.push(command);

  res.json(mapCommandForResponse(command));
});
// =====================
// جلب الأوامر
// =====================
app.get("/commands", (req, res) => {
  const { deviceUid, status } = req.query;

  let result = commands;

  if (deviceUid) {
    result = result.filter(c => c.deviceUid === deviceUid);
  }

  if (status) {
    result = result.filter(c => c.status === status);
  }

  const sortedResult = [...result].sort((a, b) => {
    const aImmediate = !a.scheduledAt;
    const bImmediate = !b.scheduledAt;

    if (aImmediate && !bImmediate) return -1;
    if (!aImmediate && bImmediate) return 1;
    if (aImmediate && bImmediate) return 0;

    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  res.json(sortedResult.map(mapCommandForResponse));
});

app.delete("/commands", (req, res) => {
  commands.length = 0;
  res.json({
    success: true,
    message: "All commands cleared"
  });
});

// =====================
// تحديث حالة الأمر
// =====================
app.post("/commands/:id/status", (req, res) => {
  const { id } = req.params;
  const { status, failureReason } = req.body;

  const command = commands.find(c => c.id === id);

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
    command.executedAt = toUtcISOString();
    command.failureReason = null;
  } else if (normalizedStatus === "failed") {
    command.failureReason =
      typeof failureReason === "string" && failureReason.trim()
        ? failureReason.trim()
        : "Command execution failed";
  } else {
    command.failureReason = null;
  }

  res.json(mapCommandForResponse(command));
});

// =====================
app.use(express.static("public"));
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});
