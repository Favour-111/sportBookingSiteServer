const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const router = express.Router();

router.post("/payment", async (req, res) => {
  try {
    // ✅ Dummy test data (replace with real values when ready)
    const dummyPayment = {
      amount: 50.0, // SGD 50.00
      currency: "SGD",
      order_id: `ORDER-${Date.now()}`,
      description: "Test purchase - Betting site demo",
      customer_email: "dummyuser@example.com",
      redirect_url: "https://your-frontend.com/payment-success",
      callback_url: "https://your-backend.com/api/payment/callback",
    };

    // ✅ Make payment request to OxPay
    const response = await axios.post(
      "https://api.oxpay.com/v1/payments",
      dummyPayment,
      {
        headers: {
          Authorization: `Bearer ${process.env.OXPAY_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    // ✅ Handle success response
    if (response.data && response.data.payment_url) {
      res.json({
        success: true,
        message: "Dummy payment created successfully!",
        payment_url: response.data.payment_url,
        data: response.data,
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Failed to create dummy payment",
        error: response.data,
      });
    }
  } catch (error) {
    console.error("Payment Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Error creating dummy payment",
      error: error.response?.data || error.message,
    });
  }
});

module.exports = router;
