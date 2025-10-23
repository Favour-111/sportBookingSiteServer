import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.post("/create-invoice", async (req, res) => {
  try {
    const {
      amount,
      currency = "USDT",
      network = "TRC20",
      description = "Payment for Order",
      referenceId,
      customer_email,
      customer_name,
    } = req.body;

    // Invoice body for OxaPay
    const body = {
      merchant: process.env.OXAPAY_MERCHANT_KEY,
      amount,
      currency,
      network,
      order_id: referenceId,
      description,
      callback_url: `${process.env.BACKEND_URL}/api/payment/oxapay-webhook`,
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      customer_email,
      customer_name,
    };

    // OxaPay invoice endpoint
    const response = await axios.post(
      "https://api.oxapay.com/v1/invoice",
      body,
      { headers: { "Content-Type": "application/json" } }
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

export default router;
