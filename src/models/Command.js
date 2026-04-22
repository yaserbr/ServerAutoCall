const mongoose = require("mongoose");

const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

const commandSchema = new mongoose.Schema(
  {
    deviceUid: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: DEVICE_UID_LENGTH,
      maxlength: DEVICE_UID_LENGTH,
      match: DEVICE_UID_REGEX,
      index: true
    },
    action: {
      type: String,
      required: true,
      enum: [
        "call",
        "end",
        "sms",
        "auto_answer",
        "open_url",
        "close_webview",
        "open_app",
        "return_to_autocall"
      ]
    },
    type: {
      type: String,
      required: true,
      enum: [
        "CALL",
        "END",
        "SMS",
        "AUTO_ANSWER",
        "OPEN_URL",
        "CLOSE_WEBVIEW",
        "OPEN_APP",
        "RETURN_TO_AUTOCALL"
      ]
    },
    phoneNumber: {
      type: String,
      default: null
    },
    message: {
      type: String,
      default: null
    },
    url: {
      type: String,
      default: null
    },
    appName: {
      type: String,
      default: null
    },
    resolvedPackageName: {
      type: String,
      default: null
    },
    notes: {
      type: String,
      default: null
    },
    durationSeconds: {
      type: Number,
      default: null
    },
    enabled: {
      type: Boolean,
      default: null
    },
    autoHangupSeconds: {
      type: Number,
      default: null
    },
    status: {
      type: String,
      enum: ["pending", "executing", "executed", "failed"],
      default: "pending",
      index: true
    },
    failureReason: {
      type: String,
      default: null
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    isImmediate: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    executedAt: {
      type: Date,
      default: null
    }
  },
  {
    versionKey: false
  }
);

commandSchema.pre("validate", function normalizeUidBeforeValidation() {
  this.deviceUid = normalizeDeviceUid(this.deviceUid);
});

commandSchema.index({ deviceUid: 1, status: 1 });
commandSchema.index({ isImmediate: -1, scheduledAt: 1, createdAt: -1 });

module.exports = mongoose.model("Command", commandSchema);
