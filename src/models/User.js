const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true
    },
    passwordHash: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

userSchema.pre("validate", function normalizeUsernameBeforeValidation() {
  if (typeof this.username === "string") {
    this.username = this.username.trim().toLowerCase();
  }
});

module.exports = mongoose.model("User", userSchema);
