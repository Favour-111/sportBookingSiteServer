const express = require("express");
const axios = require("axios");
const router = express.Router();

// ✅ OxaPay Payment Creation Route

const MERCHANT_KEY = process.env.OXAPAY_MERCHANT_KEY;
const API_BASE = "https://api.oxapay.com/v1";

if (!MERCHANT_KEY) {
  console.error("Missing OxaPay merchant key!");
  process.exit(1);
}

// 1) Create invoice/payment endpoint
router.post("/create-crypto-payment", async (req, res) => {
  try {
    const {
      amount,
      currency = "USD",
      description = "",
      referenceId,
    } = req.body;

    const body = {
      merchant_api_key: MERCHANT_KEY,
      amount: amount,
      currency: currency,
      description: description,
      reference_id: referenceId, // your internal order ID
      callback_url: `${process.env.BACKEND_URL}/api/oxapay-webhook`,
      // maybe additional fields: list of accepted crypto currencies, etc
    };

    const response = await axios.post(`${API_BASE}/payment`, body, {
      headers: { "Content-Type": "application/json" },
    });

    // response likely contains a track_id, payment_address, invoice link, etc
    return res.json(response.data);
  } catch (err) {
    console.error(
      "Error creating OxaPay invoice:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to create crypto payment invoice",
      details: err.response?.data,
    });
  }
});

// 2) Webhook endpoint to receive updates
router.post("/api/oxapay-webhook", (req, res) => {
  // Note: you might need express.raw middleware if verifying signature
  const data = req.body;

  // Example: data might contain { track_id, status, amount_paid, currency_paid, crypto_symbol, txid }
  console.log("OxaPay webhook data:", data);

  // Process accordingly: update your database order status etc
  // e.g. if data.status === 'paid' then mark order as paid

  res.status(200).send("OK");
});
module.exports = router;
