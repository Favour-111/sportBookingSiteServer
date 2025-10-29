/**
 * Escape MarkdownV2 special characters for Telegram.
 */
function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.toString().replace(/([_[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

/**
 * Wraps bot.sendMessage safely with automatic escaping and logging.
 */
async function safeSend(bot, chatId, text, extra = {}) {
  try {
    const escaped = escapeMarkdownV2(text);
    await bot.sendMessage(chatId, escaped, {
      parse_mode: "MarkdownV2",
      ...extra,
    });
  } catch (err) {
    console.error("❌ Telegram send error:", err.response?.data || err.message);
    try {
      // fallback: send plain text if markdown fails completely
      await bot.sendMessage(chatId, text);
    } catch (fallbackErr) {
      console.error("⚠️ Fallback send also failed:", fallbackErr.message);
    }
  }
}

module.exports = { safeSend, escapeMarkdownV2 };
