const express = require("express");
const Payment = require("../models/Payment");
const User = require("../models/User");
const router = express.Router();
const dotenv = require("dotenv");
const axios = require("axios");
dotenv.config();
router.post("/payment", async (req, res) => {
  const { amount, currency, email } = req.body;

  try {
    // Make the API call to OxPay
    const response = await axios.post(
      "https://api.oxpay.com/v1/payments", // OxPay API endpoint for payments
      {
        amount: amount, // Amount to be paid
        currency: currency, // Currency code (e.g., 'USD')
        email: email, // Customer's email
        // You can add any additional required parameters like description, redirect URLs, etc.
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OXPAY_API_KEY}`, // Use your OxPay Merchant API Key
          "Content-Type": "application/json",
        },
      }
    );

    // Handle the response from OxPay
    if (response.data.status === "success") {
      res.json({
        message: "Payment processed successfully",
        data: response.data,
      });
    } else {
      res.status(400).json({
        message: "Payment failed",
        error: response.data,
      });
    }
  } catch (error) {
    console.error("Error processing payment:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
