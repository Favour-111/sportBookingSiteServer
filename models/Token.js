const mongoose = require("mongoose");

const TokenSchema = new mongoose.Schema({
  userid: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 900 }, // expires in 15 min (900s)
});

module.exports = mongoose.model("Token", TokenSchema);
