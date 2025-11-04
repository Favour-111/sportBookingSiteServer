// bot_message_replacement_patch.js
// 🔄 Enables single-thread edit-in-place behavior for node-telegram-bot-api bots.

export function applySmartReply(bot) {
  const lastMessageByChat = new Map();

  async function smartReply(chatId, text, options = {}) {
    const last = lastMessageByChat.get(chatId);
    try {
      if (last) {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: last.message_id,
          ...options,
        });
      } else {
        const sent = await bot.sendMessage(chatId, text, options);
        lastMessageByChat.set(chatId, sent);
      }
    } catch {
      const sent = await bot.sendMessage(chatId, text, options);
      lastMessageByChat.set(chatId, sent);
    }
  }

  async function smartPhotoReply(chatId, photo, caption, options = {}) {
    const last = lastMessageByChat.get(chatId);
    try {
      if (last) {
        await bot.editMessageMedia(
          {
            type: "photo",
            media: photo,
            caption,
            parse_mode: options.parse_mode || "HTML",
          },
          {
            chat_id: chatId,
            message_id: last.message_id,
            reply_markup: options.reply_markup,
          }
        );
      } else {
        const sent = await bot.sendPhoto(chatId, photo, { caption, ...options });
        lastMessageByChat.set(chatId, sent);
      }
    } catch {
      const sent = await bot.sendPhoto(chatId, photo, { caption, ...options });
      lastMessageByChat.set(chatId, sent);
    }
  }

  function resetSmartReply(chatId) {
    lastMessageByChat.delete(chatId);
  }

  // ✅ Attach helpers to bot for universal access
  bot.smartReply = smartReply;
  bot.smartPhotoReply = smartPhotoReply;
  bot.resetSmartReply = resetSmartReply;
}
