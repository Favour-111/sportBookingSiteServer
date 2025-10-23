// routes/payment.js
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const User = require("../models/User"); // Adjust path
dotenv.config();

const router = express.Router();

// Middleware for JSON
router.use(express.json());

// Create OxaPay invoice
router.post("/create-invoice", async (req, res) => {
  try {
    const {
      amount,
      currency = "USD",
      to_currency = "USDT",
      order_id,
      description = "Deposit Payment",
      email,
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

    res.json(response.data);
  } catch (err) {
    console.error("OxaPay Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create OxaPay invoice",
      details: err.response?.data,
    });
  }
});

// Webhook endpoint
router.post("/oxapay-webhook", async (req, res) => {
  try {
    console.log("Webhook received:", req.body);

    const { order_id, status, amount } = req.body;

    // Extract userId from order_id: "deposit_USERID_TIMESTAMP"
    const userId = order_id.split("_")[1];

    if (status === "success" && userId) {
      const user = await User.findById(userId);
      if (user) {
        user.availableBalance = (user.availableBalance || 0) + Number(amount);
        await user.save();
        console.log(`Balance updated for user ${userId}: +${amount}`);
      }
    }

    res.status(200).json({ message: "Webhook received" });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
  }
});

module.exports = router;
