const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

console.log("🟢 Bot starting...");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.on("message", (msg) => {
  console.log("📩 Received message:", msg.text);
  bot.sendMessage(msg.chat.id, "👋 I received your message!");
});

console.log("✅ Telegram bot is running...");
