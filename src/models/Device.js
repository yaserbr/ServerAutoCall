const mongoose = require("mongoose");

const DEVICE_NAME_MAX_LENGTH = 60;

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

const deviceSchema = new mongoose.Schema(
  {
    deviceUid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    deviceName: {
      type: String,
      default: null,
      trim: true,
      maxlength: DEVICE_NAME_MAX_LENGTH
    },
    platform: {
      type: String,
      default: null,
      trim: true
    },
    online: {
      type: Boolean,
      default: false
    },
    lastSeen: {
      type: Date,
      default: null
    }
  },
  {
    versionKey: false
  }
);

deviceSchema.pre("validate", function setDefaultDeviceName() {
  const normalized = normalizeDeviceName(this.deviceName);
  if (normalized) {
    this.deviceName = normalized;
  } else {
    this.deviceName = buildDefaultDeviceName(this.deviceUid);
  }
});

module.exports = mongoose.model("Device", deviceSchema);
