// models/Message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    visibility: {
      type: String,
      enum: ["Visible", "Hidden"],
      default: "Visible",
    },

    createdAt: { type: Date, default: Date.now },
    active: { type: Boolean, default: true }, // To handle deactivate feature
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);
