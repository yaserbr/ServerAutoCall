const mongoose = require("mongoose");

const downloadLeaseSchema = new mongoose.Schema(
  {
    leaseId: {
      type: String,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    _id: false
  }
);

const downloadQuotaSchema = new mongoose.Schema(
  {
    scopeKey: {
      type: String,
      required: true
    },
    quotaDay: {
      type: String,
      required: true
    },
    bytesReserved: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    activeLeases: {
      type: [downloadLeaseSchema],
      default: []
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

downloadQuotaSchema.index({ scopeKey: 1, quotaDay: 1 }, { unique: true });
downloadQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("DownloadQuota", downloadQuotaSchema);
