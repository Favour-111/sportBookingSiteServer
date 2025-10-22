const express = require("express");
const axios = require("axios");
const router = express.Router();
const dotenv = require("dotenv");
dotenv.config();

router.post("/create-telegram-payment", async (req, res) => {
  try {
    const { amount, email } = req.body;

    const paymentData = {
      amount: amount || 10.0, // default SGD 10.00
      currency: "SGD",
      order_id: `ORDER-${Date.now()}`,
      description: "SportyPay Telegram Bot Payment",
      customer_email: email || "test@example.com",
      redirect_url: "https://your-frontend.com/payment-success",
      callback_url: "https://your-backend.com/api/payments/callback",
    };

    const response = await axios.post(
      "https://api.oxpay.com/v1/payments",
      paymentData,
      {
        headers: {
          Authorization: `Bearer ${process.env.OXPAY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "❌ Error creating OxPay payment:",
      error.response?.data || error.message
    );
    res.status(500).json({
      message: "Payment creation failed",
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;
