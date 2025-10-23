import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const MERCHANT_KEY = process.env.OXAPAY_MERCHANT_KEY;

router.post("/create-crypto-payment", async (req, res) => {
  try {
    const {
      amount,
      currency = "USDT",
      network = "TRC20",
      description = "Crypto Payment",
      referenceId,
    } = req.body;

    const body = {
      merchant: MERCHANT_KEY,
      amount,
      currency,
      network,
      order_id: referenceId,
      description,
      callback_url: `${process.env.BACKEND_URL}/api/payment/oxapay-webhook`,
      success_url: "https://yourfrontend.com/success",
      cancel_url: "https://yourfrontend.com/cancel",
    };

    const response = await axios.post(
      "https://api.oxapay.com/v1/crypto/create",
      body,
      { headers: { "Content-Type": "application/json" } }
    );

    res.json(response.data);
  } catch (err) {
    console.error("OxaPay Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to create crypto payment invoice",
      details: err.response?.data,
    });
  }
});

export default router;
