const mongoose = require("mongoose");

const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

const commandTemplateSchema = new mongoose.Schema(
  {
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
        "START_SCREEN_MIRROR",
        "STOP_SCREEN_MIRROR",
        "SCREEN_TOUCH",
        "SCREEN_SWIPE"
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
    downloadSizeMb: {
      type: Number,
      default: null
    },
    downloadDurationSeconds: {
      type: Number,
      default: null
    },
    activationCode: {
      type: String,
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
    x: {
      type: Number,
      default: null
    },
    y: {
      type: Number,
      default: null
    },
    screenWidth: {
      type: Number,
      default: null
    },
    screenHeight: {
      type: Number,
      default: null
    },
    startX: {
      type: Number,
      default: null
    },
    startY: {
      type: Number,
      default: null
    },
    endX: {
      type: Number,
      default: null
    },
    endY: {
      type: Number,
      default: null
    },
    durationMs: {
      type: Number,
      default: null
    },
    touchTarget: {
      type: String,
      default: null
    },
    delayAfterSeconds: {
      type: Number,
      default: 0,
      min: 0,
      max: 3600,
      validate: {
        validator: Number.isFinite,
        message: "delayAfterSeconds must be a number between 0 and 3600."
      }
    }
  },
  { _id: false }
);

const commandCollectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
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
      default: null,
      index: true
    },
    commandTemplates: {
      type: [commandTemplateSchema],
      required: true,
      validate: {
        validator: function(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: "A command collection must contain at least one command template."
      }
    },
    activeCommandIds: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    status: {
      type: String,
      enum: ["pending", "executing", "executed", "failed"],
      default: "pending",
      index: true
    },
    currentIndex: {
      type: Number,
      default: 0
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    versionKey: false
  }
);

commandCollectionSchema.pre("validate", function normalizeUidBeforeValidation() {
  this.deviceUid = normalizeDeviceUid(this.deviceUid);
});

module.exports = mongoose.model("CommandCollection", commandCollectionSchema);
