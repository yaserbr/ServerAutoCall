const mongoose = require("mongoose");
const {
  DEVICE_UID_LENGTH,
  DEVICE_UID_REGEX,
  normalizeDeviceUid
} = require("../domain/deviceUid");
const createCommandTemplateSchema = require("./schemas/commandTemplateSchema");

const commandTemplateSchema = createCommandTemplateSchema();

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
      required: true,
      index: true
    },
    deviceOwnershipEpoch: {
      type: String,
      required: true,
      select: false
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
      enum: ["pending", "executing", "executed", "failed", "cancelled"],
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

commandCollectionSchema.index(
  {
    deviceUid: 1,
    ownerUserId: 1,
    deviceOwnershipEpoch: 1,
    status: 1,
    activeCommandIds: 1
  },
  { name: "active_collection_command_lookup" }
);

module.exports = mongoose.model("CommandCollection", commandCollectionSchema);
