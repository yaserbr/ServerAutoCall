const mongoose = require("mongoose");

const commandSchema = new mongoose.Schema(
  {
    deviceUid: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    action: {
      type: String,
      required: true,
      enum: ["call", "end", "sms", "auto_answer"]
    },
    type: {
      type: String,
      required: true,
      enum: ["CALL", "END", "SMS", "AUTO_ANSWER"]
    },
    phoneNumber: {
      type: String,
      default: null
    },
    message: {
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

commandSchema.index({ deviceUid: 1, status: 1 });
commandSchema.index({ isImmediate: -1, scheduledAt: 1, createdAt: -1 });

module.exports = mongoose.model("Command", commandSchema);
