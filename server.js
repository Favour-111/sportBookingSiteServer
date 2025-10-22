const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/auth");
const gameRoutes = require("./routes/game");
const messageRoutes = require("./routes/message");
const paymentRoutes = require("./routes/payment");
const dotenv = require("dotenv");

dotenv.config();
const axios = require("axios");
const app = express();
app.use(express.json());
app.use(cors());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/payments", paymentRoutes);

// MongoDB connection
mongoose
  .connect(process.env.URL)
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "💳 Creating your payment link... Please wait.");

  try {
    // Call your backend to create the payment
    const res = await axios.post(
      "http://localhost:5000/api/payments/create-telegram-payment",
      {
        amount: 20.0,
        email: "telegramuser@example.com",
      }
    );

    const paymentUrl = res.data.payment_url || res.data.url;

    if (paymentUrl) {
      bot.sendMessage(
        chatId,
        `✅ Your payment is ready! Click below to complete it:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔗 Pay via OxPay", url: paymentUrl }]],
          },
        }
      );
    } else {
      bot.sendMessage(chatId, "⚠️ Could not create a payment link.");
    }
  } catch (error) {
    console.error("Bot Payment Error:", error.message);
    bot.sendMessage(chatId, "❌ Error connecting to OxPay payment service.");
  }
});
