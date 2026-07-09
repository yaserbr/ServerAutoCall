const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

// Compound unique index per user to prevent duplicate contact names
contactSchema.index({ userId: 1, name: 1 }, { unique: true });
contactSchema.index({ userId: 1, phoneNumber: 1 });

module.exports = mongoose.model("Contact", contactSchema);
