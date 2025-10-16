const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  availableBalance: { type: Number, default: 0 },

  betHistory: [
    {
      gameId: String,
      gameContent: String,
      gameName: String,
      gameDate: Date,
      tipPrice: Number,
      tipOdd: String,
      tipName: String,
      status: { type: String, default: "Pending" },
    },
  ],
  role: { type: String, default: "customer" },
  totalMoneySpent: { type: Number, default: 0 },
  totalBetsBought: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model("User", UserSchema);
