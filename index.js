const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 تخزين مؤقت (in-memory)
const devices = [];
const commands = [];

function formatRiyadhDate(dateValue) {
  if (!dateValue) return null;
  return new Date(dateValue).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    hour12: false
  });
}

function mapCommandForResponse(command) {
  return {
    ...command,
    createdAt: formatRiyadhDate(command.createdAt),
    executedAt: formatRiyadhDate(command.executedAt),
    scheduledAt: formatRiyadhDate(command.scheduledAt)
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
      lastSeen: new Date()
    };
    devices.push(device);
  } else {
    device.online = true;
    device.lastSeen = new Date();
  }

  res.json({ success: true, device });
});

// =====================
// heartbeat
// =====================
app.post("/devices/heartbeat", (req, res) => {
  const { deviceUid } = req.body;

  const device = devices.find(d => d.deviceUid === deviceUid);

  if (device) {
    device.online = true;
    device.lastSeen = new Date();
  }

  res.json({ success: true });
});

// =====================
// جلب الأجهزة
// =====================
app.get("/devices", (req, res) => {
  res.json(devices);
});

// =====================
// إنشاء أمر اتصال
// =====================
app.post("/commands", (req, res) => {
  const { deviceUid, phoneNumber, scheduledAt } = req.body;
  let scheduledAtIso = null;

  if (scheduledAt) {
    const parsedDate = new Date(scheduledAt);
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
      scheduledAtIso = parsedDate.toISOString();
    }
  }

  const command = {
    id: Date.now().toString(),
    deviceUid,
    type: "CALL",
    phoneNumber,
    status: "pending",
    scheduledAt: scheduledAtIso,
    isImmediate: scheduledAtIso === null,
    createdAt: new Date().toISOString()
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
    command.executedAt = new Date().toISOString();
  }

  res.json(mapCommandForResponse(command));
});

// =====================
app.use(express.static("public"));
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});
