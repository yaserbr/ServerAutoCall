const mongoose = require("mongoose");

// Fixed-window counters are stored in MongoDB so enrollment limits are shared
// by every server instance. The identifier itself is hashed before it is used
// as _id, so client IP addresses and device UIDs are not retained in plaintext.
const enrollmentRateLimitSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true
    },
    scope: {
      type: String,
      enum: ["ip", "device_uid"],
      required: true
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
      required: true
    },
    windowStartedAt: {
      type: Date,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    versionKey: false
  }
);

// Abandoned rate-limit windows remove themselves after the fixed window ends.
enrollmentRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("EnrollmentRateLimit", enrollmentRateLimitSchema);
