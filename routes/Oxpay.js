const express = require("express");
const axios = require("axios");
const router = express.Router();

// POST /api/payment/create-payment
router.post("/create-payment", async (req, res) => {
  const { amount, orderId } = req.body;

  if (!amount || !orderId) {
    return res
      .status(400)
      .json({ result: 0, message: "amount and orderId are required" });
  }

  try {
    const response = await axios.post(
      "https://api.oxapay.com/api/v1/create-payment", // Use sandbox if your key is test mode
      {
        merchant: process.env.OXAPAY_MERCHANT_KEY, // Your merchant key from dashboard
        amount: amount,
        currency: "USD",
        orderId: orderId,
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

    // Forward OxaPay response directly to frontend/Postman
    res.json(response.data);
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    res
      .status(500)
      .json(
        error.response?.data || {
          result: 0,
          message: "Payment creation failed",
        }
      );
  }
});

module.exports = router;
