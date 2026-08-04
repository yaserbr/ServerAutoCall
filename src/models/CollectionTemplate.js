const mongoose = require("mongoose");
const createCommandTemplateSchema = require("./schemas/commandTemplateSchema");

const commandTemplateSchema = createCommandTemplateSchema();

const collectionTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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
        message: "A collection template must contain at least one command template."
      }
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    versionKey: false
  }
);

// Compounding index for unique names per user (allows duplicate names across different users)
collectionTemplateSchema.index({ ownerUserId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CollectionTemplate", collectionTemplateSchema);
