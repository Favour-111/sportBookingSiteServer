const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot("YOUR_BOT_API_KEY", { polling: true });

bot.onText(/\/addgame/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "Please send the game details: name, description, price."
  );

  // Add logic to handle game details input and add it to the database
});
