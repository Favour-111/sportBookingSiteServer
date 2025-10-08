const express = require("express");
const Payment = require("../models/Payment");
const User = require("../models/User");
const router = express.Router();

router.post("/fund", async (req, res) => {
  const { userId, amount, paymentMethod } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ message: "User not found" });

    const payment = new Payment({
      userId,
      amount,
      paymentMethod,
      status: "pending",
    });
    await payment.save();

    // Update user balance if payment is completed
    user.availableBalance += amount;
    await user.save();

    res.json({ message: "Payment successful, balance updated" });
  } catch (error) {
    res.status(500).json({ message: "Error processing payment" });
  }
});

module.exports = router;
