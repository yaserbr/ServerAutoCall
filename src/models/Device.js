const mongoose = require("mongoose");

const DEVICE_NAME_MAX_LENGTH = 60;
const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
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

const deviceSchema = new mongoose.Schema(
  {
    deviceUid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: DEVICE_UID_LENGTH,
      maxlength: DEVICE_UID_LENGTH,
      match: DEVICE_UID_REGEX,
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
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true
    },
    deviceTokenHash: {
      type: String,
      default: null,
      select: false
    },
    deviceTokenIssuedAt: {
      type: Date,
      default: null
    },
    claimedAt: {
      type: Date,
      default: null
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

deviceSchema.index({ deviceTokenHash: 1 }, { sparse: true });

deviceSchema.pre("validate", function setDefaultDeviceName() {
  this.deviceUid = normalizeDeviceUid(this.deviceUid);
  const normalized = normalizeDeviceName(this.deviceName);
  if (normalized) {
    this.deviceName = normalized;
  } else {
    this.deviceName = buildDefaultDeviceName(this.deviceUid);
  }
});

module.exports = mongoose.model("Device", deviceSchema);
