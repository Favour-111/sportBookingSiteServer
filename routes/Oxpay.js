const express = require("express");
const axios = require("axios");
const router = express.Router();

// ✅ OxaPay Payment Creation Route
router.post("/create-payment2", async (req, res) => {
  const { amount, orderId } = req.body;

  if (!amount || !orderId) {
    return res.status(400).json({
      result: 0,
      message: "amount and orderId are required",
    });
  }

  try {
    const response = await axios.post(
      // ✅ Use correct endpoint depending on mode
      "https://api.oxapay.com/api/v1/create-payment", // LIVE
      {
        merchant: process.env.OXAPAY_MERCHANT_KEY, // Your test merchant key
        amount,
        currency: "USD",
        orderId,
        callbackUrl: "https://yourwebsite.com/payment-callback",
        cancelUrl: "https://yourwebsite.com/payment-cancelled",
        successUrl: "https://yourwebsite.com/payment-success",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    return res.status(500).json(
      error.response?.data || {
        result: 0,
        message: "Payment creation failed",
      }
    );
  }
});
router.post("/create-payment", async (req, res) => {
  const { amount, orderId } = req.body;

  if (!amount || !orderId) {
    return res.status(400).json({
      result: 0,
      message: "amount and orderId are required",
    });
  }

  try {
    const response = await axios.post(
      // ✅ Use correct endpoint depending on mode
      // "https://api.oxapay.com/api/v1/create-payment"  // LIVE
      "https://sandbox.oxapay.com/api/v1/create-payment", // SANDBOX (TEST MODE)
      {
        merchant: process.env.OXAPAY_MERCHANT_KEY, // Your test merchant key
        amount,
        currency: "USD",
        orderId,
        callbackUrl: "https://yourwebsite.com/payment-callback",
        cancelUrl: "https://yourwebsite.com/payment-cancelled",
        successUrl: "https://yourwebsite.com/payment-success",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    return res.status(500).json(
      error.response?.data || {
        result: 0,
        message: "Payment creation failed",
      }
    );
  }
});

module.exports = router;
