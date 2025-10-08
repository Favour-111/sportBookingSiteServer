const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  availableBalance: { type: Number, default: 0 },
  betHistory: [
    {
      gameId: { type: mongoose.Schema.Types.ObjectId, ref: "Game" },
      betAmount: Number,
      result: String, // 'win' or 'loss'
    },
  ],
  totalMoneySpent: { type: Number, default: 0 },
  totalBetsBought: { type: Number, default: 0 },
});

module.exports = mongoose.model("User", UserSchema);
