const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 تخزين مؤقت (in-memory)
const devices = [];
const commands = [];

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
  const { deviceUid, phoneNumber } = req.body;

  const command = {
    id: Date.now().toString(),
    deviceUid,
    type: "CALL",
    phoneNumber,
    status: "pending",
    createdAt: new Date()
  };

  commands.push(command);

  res.json(command);
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

  res.json(result);
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

  command.status = status;

  res.json(command);
});

// =====================
app.use(express.static("public"));
app.listen(4000, () => {
  console.log("🚀 Server running on http://localhost:4000");
});