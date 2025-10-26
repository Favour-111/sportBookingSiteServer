const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// Replace with your Telegram bot token
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Replace with your backend endpoint
const BACKEND_URL = `${process.env.SERVER}/api/games/add`;

// Optional: restrict access to only you
const ADMIN_ID = process.env.TELEGRAM_CHAT_ID; // replace with your Telegram ID

// Store user sessions temporarily
const sessions = {};
console.log(ADMIN_ID);

bot.onText(/\/addgame/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userId !== Number(ADMIN_ID)) {
    return bot.sendMessage(chatId, "🚫 You are not authorized to add games.");
  }

  sessions[chatId] = { step: 1, data: {} };
  bot.sendMessage(chatId, "🎮 Enter the *Game Title*:", {
    parse_mode: "Markdown",
  });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Ignore messages that are not part of /addgame flow
  if (!sessions[chatId] || text.startsWith("/")) return;

  const session = sessions[chatId];

  switch (session.step) {
    case 1:
      session.data.tipTitle = text;
      session.step++;
      bot.sendMessage(chatId, "💰 Enter the *Price* of the tip:", {
        parse_mode: "Markdown",
      });
      break;

    case 2:
      session.data.tipPrice = Number(text);
      session.step++;
      bot.sendMessage(chatId, "📈 Enter the *Odd Ratio* (e.g. 2.5):", {
        parse_mode: "Markdown",
      });
      break;

    case 3:
      session.data.oddRatio = Number(text);
      session.step++;
      bot.sendMessage(chatId, "🖼️ Enter the *Image URL* for this game:", {
        parse_mode: "Markdown",
      });
      break;

    case 4:
      session.data.image = text;
      session.step++;
      bot.sendMessage(chatId, "🔥 Enter the *Confidence Level* (max is 5):", {
        parse_mode: "Markdown",
      });
      break;

    case 5:
      session.data.confidenceLevel = text;
      session.step++;
      bot.sendMessage(chatId, "⏱️ Enter the *Duration* (in minutes):", {
        parse_mode: "Markdown",
      });
      break;

    case 6:
      session.data.duration = Number(text);
      session.step++;
      bot.sendMessage(
        chatId,
        "🏦 Enter the *Betting Sites* separated by commas (e.g. Bet9ja,1xbet):",
        { parse_mode: "Markdown" }
      );
      break;

    case 7:
      session.data.bettingSites = text.split(",").map((s) => s.trim());
      session.step++;
      bot.sendMessage(chatId, "📝 Enter the *Content After Purchase*:", {
        parse_mode: "Markdown",
      });
      break;

    case 8:
      session.data.contentAfterPurchase = text;
      session.step++;

      // ✅ Add default values
      session.data.purchaseLimit = 100;

      // ✅ Save to backend
      try {
        const res = await axios.post(BACKEND_URL, session.data);
        bot.sendMessage(
          chatId,
          `✅ Game added successfully!\n\n*Title:* ${session.data.tipTitle}\n*Price:* ₦${session.data.tipPrice}\n*Odd:* ${session.data.oddRatio}\n*Confidence:* ${session.data.confidenceLevel}\n*Image:* ${session.data.image}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error(err.response?.data || err.message);
        bot.sendMessage(chatId, "⚠️ Error adding game. Please try again.");
      }

      delete sessions[chatId];
      break;

    default:
      bot.sendMessage(
        chatId,
        "❌ Something went wrong. Please start again with /addgame"
      );
      delete sessions[chatId];
      break;
  }
});
