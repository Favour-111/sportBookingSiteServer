const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.on("message", (msg) => {
  console.log("📩 Received message:", msg.text);
});

bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const payload = match[1]?.trim().replace(/^_/, "");

  console.log("🚀 Start command received with payload:", payload);

  if (payload && payload.startsWith("pay_")) {
    const [_, userId, amount] = payload.split("_");

    bot.sendMessage(
      chatId,
      `✅ Payment initiated!\n\nUser ID: ${userId}\nAmount: ₦${amount}`
    );
  } else {
    bot.sendMessage(
      chatId,
      "👋 Welcome to SportyPay Bot!\n\nTry opening this link:\n" +
        "https://t.me/SportyPayBot?start=pay_user123_5000"
    );
  }
});

console.log("✅ Telegram bot is running...");
