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
        "return_to_autocall",
        "download_data",
        "start_screen_mirror",
        "stop_screen_mirror",
        "screen_touch",
        "screen_swipe"
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
        "RETURN_TO_AUTOCALL",
        "DOWNLOAD_DATA",
        "START_SCREEN_MIRROR",
        "STOP_SCREEN_MIRROR",
        "SCREEN_TOUCH",
        "SCREEN_SWIPE"
      ]
    },
    phoneNumber: {
      type: String
    },
    message: {
      type: String
    },
    url: {
      type: String
    },
    appName: {
      type: String
    },
    resolvedPackageName: {
      type: String
    },
    notes: {
      type: String
    },
    durationSeconds: {
      type: Number
    },
    downloadSizeMb: {
      type: Number
    },
    downloadDurationSeconds: {
      type: Number
    },
    enabled: {
      type: Boolean
    },
    autoHangupSeconds: {
      type: Number
    },
    x: {
      type: Number
    },
    y: {
      type: Number
    },
    screenWidth: {
      type: Number
    },
    screenHeight: {
      type: Number
    },
    startX: {
      type: Number
    },
    startY: {
      type: Number
    },
    endX: {
      type: Number
    },
    endY: {
      type: Number
    },
    durationMs: {
      type: Number
    },
    touchTarget: {
      type: String
    },
    status: {
      type: String,
      enum: ["pending", "executing", "executed", "failed"],
      default: "pending",
      index: true
    },
    failureReason: {
      type: String
    },
    scheduledAt: {
      type: Date
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
      type: Date
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
