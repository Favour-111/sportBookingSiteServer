const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const User = require("../models/User");
dotenv.config();

const router = express.Router();

// === Telegram Config ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// === Helper: send Telegram message ===
const sendTelegramMessage = async (message) => {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "Markdown",
      }
    );
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
  }
};

// === Create OxaPay Invoice ===
router.post("/create-invoice", async (req, res) => {
  try {
    const {
      amount,
      currency = "USD",
      to_currency = "USDT",
      order_id,
      description = "Deposit Payment",
      email,
      username,
      userId,
    } = req.body;

    const callback_url = `${process.env.SERVER}/api/payment/oxapay-webhook`;
    const return_url = `${process.env.API}/`;

    const body = {
      amount,
      currency,
      to_currency,
      order_id,
      description,
      callback_url,
      return_url,
      email,
      fee_paid_by_payer: 1,
      under_paid_coverage: 10,
      auto_withdrawal: true,
      mixed_payment: true,
      sandbox: true, // false in production
    };

    const response = await axios.post(
      "https://api.oxapay.com/v1/payment/invoice",
      body,
      {
        headers: {
          "Content-Type": "application/json",
          merchant_api_key: process.env.OXAPAY_MERCHANT_KEY,
        },
      }
    );

    const { track_id, pay_url } = response.data;

    // 🟢 Send Telegram alert when invoice is created
    // await sendTelegramMessage(
    //   `🟢 *New Payment Request Created*\n\n👤 *User:* ${username}\n📧 *Email:* ${email}\n🆔 *User ID:* ${userId}\n💰 *Amount:* $${amount}\n📦 *Track ID:* ${track_id}\n🔗 [Open Payment Link](${pay_url})`
    // );

    res.json(response.data);
  } catch (err) {
    console.error("OxaPay Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create OxaPay invoice",
      details: err.response?.data,
    });
  }
});

// === Webhook ===
router.post("/oxapay-webhook", async (req, res) => {
  try {
    console.log("Webhook received:", req.body);

    const { order_id, status, amount } = req.body;
    const userId = order_id.split("_")[1];

    if ((status === "Paid" || status === "success") && userId) {
      const user = await User.findById(userId);
      if (user) {
        user.availableBalance = (user.availableBalance || 0) + Number(amount);
        await user.save();

        console.log(`Balance updated for user ${userId}: +${amount}`);

        // 🟢 Telegram alert for successful payment
        await sendTelegramMessage(`
✅ *Payment Confirmed!*

👤 *User:* ${user.userName} (${user.email})
🆔 *User ID:* ${userId}

💰 *Amount:* $${amount}
📦 *Order ID:* ${order_id}

📅 *Date:* ${new Date().toLocaleString()}
`);
      }
    }

    res.status(200).json({ message: "Webhook received" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;
