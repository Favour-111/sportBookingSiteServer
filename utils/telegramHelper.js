const axios = require("axios");

/**
 * Escapes MarkdownV2 entities for Telegram messages.
 * Safe for all user and game data.
 */
function escapeMarkdown(text) {
  if (!text) return "";
  return text.toString().replace(/([_[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

/**
 * Safely sends a message to Telegram using MarkdownV2.
 * Handles escaping automatically and logs errors clearly.
 */
async function sendSafeTelegramMessage(
  chatId,
  message,
  botToken = process.env.TELEGRAM_BOT_TOKEN
) {
  try {
    const escaped = escapeMarkdown(message);

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: escaped,
      parse_mode: "MarkdownV2",
    });

    console.log(`✅ Telegram message sent successfully to ${chatId}`);
  } catch (err) {
    console.error("❌ Telegram send error:", err.response?.data || err.message);
  }
}

module.exports = { sendSafeTelegramMessage, escapeMarkdown };
