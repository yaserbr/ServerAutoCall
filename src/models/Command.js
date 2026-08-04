const mongoose = require("mongoose");

const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);
const ACTION_TO_TYPE = {
  call: "CALL",
  end: "END",
  sms: "SMS",
  auto_answer: "AUTO_ANSWER",
  open_url: "OPEN_URL",
  close_webview: "CLOSE_WEBVIEW",
  open_app: "OPEN_APP",
  return_to_autocall: "RETURN_TO_AUTOCALL",
  download_data: "DOWNLOAD_DATA",
  activate_esim: "ACTIVATE_ESIM",
  delete_esim: "DELETE_ESIM",
  start_screen_mirror: "START_SCREEN_MIRROR",
  stop_screen_mirror: "STOP_SCREEN_MIRROR",
  screen_touch: "SCREEN_TOUCH",
  screen_swipe: "SCREEN_SWIPE"
};

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
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    deviceOwnershipEpoch: {
      type: String,
      required: true,
      select: false
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
        "activate_esim",
        "delete_esim",
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
        "ACTIVATE_ESIM",
        "DELETE_ESIM",
        "START_SCREEN_MIRROR",
        "STOP_SCREEN_MIRROR",
        "SCREEN_TOUCH",
        "SCREEN_SWIPE"
      ]
    },
    phoneNumber: {
      type: String,
      maxlength: 40
    },
    message: {
      type: String,
      maxlength: 4000
    },
    url: {
      type: String,
      maxlength: 2048
    },
    appName: {
      type: String,
      maxlength: 200
    },
    resolvedPackageName: {
      type: String
    },
    notes: {
      type: String,
      maxlength: 1000
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
    downloadStartedAt: {
      type: Date,
      default: null,
      select: false
    },
    downloadCompletedAt: {
      type: Date,
      default: null,
      select: false
    },
    downloadBytesSent: {
      type: Number,
      default: null,
      select: false
    },
    downloadLeaseId: {
      type: String,
      default: null,
      select: false
    },
    downloadLeaseExpiresAt: {
      type: Date,
      default: null,
      select: false
    },
    activationCode: {
      type: String,
      maxlength: 512
    },
    esimSubscriptionId: {
      type: Number
    },
    esimPortIndex: {
      type: Number
    },
    subscriptionId: {
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
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CommandCollection",
      default: null,
      index: true
    },
    collectionName: {
      type: String
    },
    collectionStepIndex: {
      type: Number
    },
    collectionTotalSteps: {
      type: Number
    },
    status: {
      type: String,
      enum: ["pending", "executing", "executed", "failed", "cancelled"],
      default: "pending",
      index: true
    },
    failureReason: {
      type: String,
      maxlength: 1000
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

  if (this.isNew) {
    this.downloadStartedAt = undefined;
    this.downloadCompletedAt = undefined;
    this.downloadBytesSent = undefined;
    this.downloadLeaseId = undefined;
    this.downloadLeaseExpiresAt = undefined;

    if (ACTION_TO_TYPE[this.action] !== this.type) {
      this.invalidate("type", "action and type must match");
    }

    const requireNonEmptyString = (pathName, message) => {
      const value = this[pathName];
      if (typeof value !== "string" || !value.trim()) {
        this.invalidate(pathName, message);
      }
    };
    const requireFiniteNumber = (pathName, { min, max, integer = false }) => {
      const value = this[pathName];
      const valid =
        Number.isFinite(value) &&
        (!integer || Number.isInteger(value)) &&
        value >= min &&
        value <= max;
      if (!valid) this.invalidate(pathName, `${pathName} is out of range`);
    };

    if (this.action === "call" || this.action === "sms") {
      requireNonEmptyString("phoneNumber", "phoneNumber is required");
    }
    if (this.action === "sms") {
      requireNonEmptyString("message", "message is required");
    }
    if (this.action === "open_url") {
      requireNonEmptyString("url", "url is required");
      try {
        const parsedUrl = new URL(this.url);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          this.invalidate("url", "url must use http or https");
        }
      } catch (_error) {
        this.invalidate("url", "url must be valid");
      }
    }
    if (this.action === "open_app") {
      requireNonEmptyString("appName", "appName is required");
      requireNonEmptyString("resolvedPackageName", "resolvedPackageName is required");
    }
    if (this.action === "download_data") {
      requireFiniteNumber("downloadSizeMb", { min: 10, max: 1000, integer: true });
    }
    if (this.action === "activate_esim") {
      requireNonEmptyString("activationCode", "activationCode is required");
    }
    if (this.action === "delete_esim") {
      requireFiniteNumber("esimSubscriptionId", { min: 0, max: Number.MAX_SAFE_INTEGER, integer: true });
    }
    if (this.action === "auto_answer" && typeof this.enabled !== "boolean") {
      this.invalidate("enabled", "enabled must be a boolean");
    }
    if (this.action === "screen_touch") {
      const hasTouchTarget = ["back", "home", "recents"].includes(this.touchTarget);
      if (!hasTouchTarget) {
        requireFiniteNumber("x", { min: 0, max: 20000, integer: true });
        requireFiniteNumber("y", { min: 0, max: 20000, integer: true });
        requireFiniteNumber("screenWidth", { min: 1, max: 20000, integer: true });
        requireFiniteNumber("screenHeight", { min: 1, max: 20000, integer: true });
        if (
          Number.isFinite(this.x) &&
          Number.isFinite(this.y) &&
          Number.isFinite(this.screenWidth) &&
          Number.isFinite(this.screenHeight) &&
          (this.x >= this.screenWidth || this.y >= this.screenHeight)
        ) {
          this.invalidate("x", "touch coordinates must be within screen bounds");
        }
      }
    }
    if (this.action === "screen_swipe") {
      for (const pathName of ["startX", "startY", "endX", "endY"]) {
        requireFiniteNumber(pathName, { min: 0, max: 20000, integer: true });
      }
      requireFiniteNumber("durationMs", { min: 50, max: 10000, integer: true });
    }
  }
});

commandSchema.index({ deviceUid: 1, status: 1, createdAt: -1 });
commandSchema.index({ deviceUid: 1, ownerUserId: 1, deviceOwnershipEpoch: 1, status: 1 });
commandSchema.index({ deviceUid: 1, status: 1 });
commandSchema.index({ isImmediate: -1, scheduledAt: 1, createdAt: -1 });
commandSchema.index({ deviceUid: 1, createdAt: -1 });

module.exports = mongoose.model("Command", commandSchema);
