// routes/oxapay.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

router.post("/create-payment", async (req, res) => {
  const { amount, orderId } = req.body;

  try {
    const response = await axios.post(
      "https://api.oxapay.com/merchant/create-payment",
      {
        merchant: process.env.OXAPAY_API_KEY, // secure key from .env
        amount: amount,
        currency: "USD",
        orderId: orderId,
        callbackUrl: "https://yourwebsite.com/payment-callback",
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Payment creation failed" });
  }
});

module.exports = router;
