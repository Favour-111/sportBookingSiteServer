const express = require("express");
const router = express.Router();
const axios = require("axios");
const User = require("../models/User");

// ✅ Create invoice for Telegram Stars
router.post("/createInvoice", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount)
      return res.status(400).json({ message: "userId and amount required" });

    const payload = `${userId}:${amount}:${Date.now()}`;
    const invoice = {
      title: "Account Top-Up 💫",
      description: `Add ₦${amount} to your balance`,
      currency: "XTR", // Telegram Stars currency
      prices: [{ label: `₦${amount} Top-up`, amount: amount * 100 }],
      payload,
    };

    res.status(200).json({ success: true, invoice });
  } catch (err) {
    console.error("Invoice creation error:", err);
    res.status(500).json({ message: "Failed to create invoice" });
  }
});

// ✅ Telegram webhook for successful payments
router.post("/webhook", async (req, res) => {
  try {
    const update = req.body;

    if (update.successful_payment) {
      const { invoice_payload } = update.successful_payment;
      const [userId, amount] = invoice_payload.split(":");

      const user = await User.findById(userId);
      if (!user) return res.sendStatus(404);

      user.availableBalance = (user.availableBalance || 0) + parseInt(amount);
      await user.save();

      console.log(`✅ ${user.userName || user.email} credited ₦${amount}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(500);
  }
});

module.exports = router;
