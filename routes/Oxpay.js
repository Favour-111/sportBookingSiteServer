const express = require("express");
const axios = require("axios");
const router = express.Router();

router.post("/create-payment", async (req, res) => {
  const { amount, orderId } = req.body;

  try {
    const response = await axios.post(
      "https://api.oxapay.com/api/v1/create-payment",
      {
        merchant: process.env.OXAPAY_API_KEY,
        amount: amount,
        currency: "USD",
        orderId: orderId,
        callbackUrl: "https://yourwebsite.com/payment-callback",
        cancelUrl: "https://yourwebsite.com/payment-cancelled",
        successUrl: "https://yourwebsite.com/payment-success",
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    res
      .status(500)
      .json(error.response?.data || { error: "Payment creation failed" });
  }
});

module.exports = router;
