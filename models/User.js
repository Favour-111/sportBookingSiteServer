const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  email: { type: String, required: true },
  password: { type: String, required: true },
  availableBalance: { type: Number, default: 0 },

  betHistory: [
    {
      gameContent: String,
      gameName: String,
      gameDate: Date,
      tipPrice: Number,
    },
  ],

  totalMoneySpent: { type: Number, default: 0 },
  totalBetsBought: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});

module.exports = mongoose.model("User", UserSchema);
