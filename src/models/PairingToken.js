const mongoose = require("mongoose");

const pairingTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 64,
      maxlength: 64,
      index: true
    },
    manualCodeHash: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      minlength: 64,
      maxlength: 64
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    used: {
      type: Boolean,
      default: false,
      index: true
    },
    usedAt: {
      type: Date,
      default: null
    },
    usedByDeviceUid: {
      type: String,
      default: null,
      trim: true,
      lowercase: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

pairingTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
pairingTokenSchema.index({ userId: 1, createdAt: -1 });
pairingTokenSchema.index(
  { manualCodeHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      manualCodeHash: { $type: "string" }
    }
  }
);

module.exports = mongoose.model("PairingToken", pairingTokenSchema);
