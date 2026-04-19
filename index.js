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
  const { deviceUid, action, phoneNumber, scheduledAt, durationSeconds } = req.body;
  let scheduledAtIso = null;
  const normalizedAction =
    typeof action === "string" && action.trim()
      ? action.trim().toLowerCase()
      : "call";

  if (normalizedAction !== "call") {
    return res.status(400).json({ error: "Invalid action. Only 'call' is supported." });
  }

  let normalizedDurationSeconds = null;
  if (durationSeconds !== undefined && durationSeconds !== null) {
    const parsedDuration = Number(durationSeconds);
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      return res.status(400).json({ error: "durationSeconds must be a number greater than 0" });
    }
    normalizedDurationSeconds = parsedDuration;
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
    action: "call",
    type: "CALL",
    phoneNumber,
    durationSeconds: normalizedDurationSeconds,
    status: "pending",
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
  const { status } = req.body;

  const command = commands.find(c => c.id === id);

  if (!command) {
    return res.status(404).json({ error: "Command not found" });
  }

  if (command.status !== "pending") {
    return res.json(mapCommandForResponse(command));
  }

  command.status = status;

  if (status === "executed") {
    command.executedAt = toUtcISOString();

  }

  res.json(mapCommandForResponse(command));
});

// =====================
app.use(express.static("public"));
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});
