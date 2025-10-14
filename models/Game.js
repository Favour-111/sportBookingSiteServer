const mongoose = require("mongoose");

const GameSchema = new mongoose.Schema({
  tipTitle: { type: String, required: true },
  tipPrice: { type: Number, required: true },
  oddRatio: { type: Number, required: true },
  bettingType: { type: String, required: true },
  bettingSites: { type: [String], required: true }, // assuming an array of betting sites
  confidenceLevel: { type: String, required: true }, // you could also use Number if it's a rating
  contentAfterPurchase: { type: String, required: true },
  duration: { type: Number, required: true }, // assuming duration is in minutes or hours
  purchaseLimit: { type: Number },
  CurrentLimit: { type: Number, default: 0 },
  active: { type: Boolean, default: false },
  purchasedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

module.exports = mongoose.model("Game", GameSchema);
