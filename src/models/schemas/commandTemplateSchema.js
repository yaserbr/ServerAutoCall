const mongoose = require("mongoose");
const { COMMAND_ACTIONS, COMMAND_TYPES } = require("../../domain/commandTypes");

function createCommandTemplateSchema() {
  return new mongoose.Schema(
    {
      action: {
        type: String,
        required: true,
        enum: COMMAND_ACTIONS
      },
      type: {
        type: String,
        required: true,
        enum: COMMAND_TYPES
      },
      phoneNumber: { type: String, default: null },
      message: { type: String, default: null },
      url: { type: String, default: null },
      appName: { type: String, default: null },
      resolvedPackageName: { type: String, default: null },
      notes: { type: String, default: null },
      durationSeconds: { type: Number, default: null },
      downloadSizeMb: { type: Number, default: null },
      downloadDurationSeconds: { type: Number, default: null },
      activationCode: { type: String, default: null },
      esimSubscriptionId: { type: Number, default: null },
      esimPortIndex: { type: Number, default: null },
      subscriptionId: { type: Number, default: null },
      enabled: { type: Boolean, default: null },
      autoHangupSeconds: { type: Number, default: null },
      x: { type: Number, default: null },
      y: { type: Number, default: null },
      screenWidth: { type: Number, default: null },
      screenHeight: { type: Number, default: null },
      startX: { type: Number, default: null },
      startY: { type: Number, default: null },
      endX: { type: Number, default: null },
      endY: { type: Number, default: null },
      durationMs: { type: Number, default: null },
      touchTarget: { type: String, default: null },
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
}

module.exports = createCommandTemplateSchema;
