const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const router = express.Router();

router.post("/create-invoice", async (req, res) => {
  try {
    const {
      amount,
      currency = "USD",
      to_currency = "USDT",
      lifetime = 60,
      order_id,
      description = "Payment for Order",
      callback_url = `http://localhost:4000/api/payment/oxapay-webhook`,
      return_url = `http://localhost:4000/success`,
      email,
      thanks_message = "Thank you for your payment",
    } = req.body;

    const body = {
      amount,
      currency,
      to_currency,
      lifetime,
      order_id,
      description,
      callback_url,
      return_url,
      email,
      thanks_message,
      fee_paid_by_payer: 1,
      under_paid_coverage: 10,
      auto_withdrawal: true,
      mixed_payment: true,
      sandbox: true, // set to false in production
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

module.exports = router;
