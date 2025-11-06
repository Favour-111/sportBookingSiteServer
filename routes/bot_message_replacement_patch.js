const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { escapeMarkdownV2, safeSend } = require("../utils/telegramSafe");
const User = require("../models/User");
const LinkToken = require("./LinkToken");
// === CONFIG ===
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set in env");

const bot = new TelegramBot(token, { polling: true });
const BACKEND_URL = process.env.SERVER || "http://localhost:5000"; // backend base url
// Support multiple admin IDs (comma-separated)
const ADMIN_ID = (process.env.TELEGRAM_CHAT_ID || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => !isNaN(id));

// In-memory stores (simple, can be replaced with Redis/Mongo later)
const userContext = new Map(); // key: chatId, value: { userId, balance, telegramId }
const sessions = {}; // key: chatId, value: session info for flows

// Escape for MarkdownV2 (used in many bot messages)
function escapeMarkdown(text = "") {
  return text.toString().replace(/([_[\]()~`>#+=|{}.!\\-])/g, "\\$1");
}

// Escape for HTML (use if parse_mode: "HTML")
function escapeHTML(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function safeSendHTML(bot, chatId, html, options = {}) {
  try {
    await bot.sendMessage(chatId, html, {
      parse_mode: "HTML",
      ...options,
    });
  } catch (err) {
    console.error("HTML send error:", err.message || err);
    // fallback: send plain text if Telegram rejects the HTML
    await bot.sendMessage(chatId, html.replace(/<[^>]*>/g, ""));
  }
}

// === HTTP helpers ===
async function apiGet(path) {
  return axios.get(`${BACKEND_URL}${path}`);
}
async function apiPost(path, body) {
  return axios.post(`${BACKEND_URL}${path}`, body);
}
async function apiPut(path, body) {
  return axios.put(`${BACKEND_URL}${path}`, body);
}
async function apiDelete(path) {
  return axios.delete(`${BACKEND_URL}${path}`);
}

// === Utility: ensure user exists in backend and in userContext ===
async function ensureUserContext(chatId, from) {
  const tgIdStr = chatId.toString();

  // 1️⃣ Check in-memory cache first
  let ctx = userContext.get(chatId);
  if (ctx && ctx.userId) return ctx;

  try {
    // 2️⃣ Check if this Telegram ID is already linked to a website account
    let user = await User.findOne({ telegramId: tgIdStr });

    if (!user) {
      // 3️⃣ If not linked, create a Telegram-only user
      const userName =
        (from && (from.first_name || from.username)) || `User_${chatId}`;
      const email = `${
        (from && from.username) || `tg_${chatId}`
      }@telegram.local`;

      const res = await apiPost("/api/auth/telegram-signup", {
        telegramId: tgIdStr,
        userName,
        email,
      });

      user = res.data.user;
      if (!user || !user._id)
        throw new Error("Invalid user response from backend");
    }

    // 4️⃣ Store context in memory
    ctx = {
      userId: user._id,
      balance: user.availableBalance || 0,
      telegramId: tgIdStr,
    };
    userContext.set(chatId, ctx);

    console.log(
      `✅ ensureUserContext set for chat ${chatId} => user ${user._id}`
    );
    return ctx;
  } catch (err) {
    console.error("ensureUserContext error:", err.message || err);
    throw err;
  }
}

// === Helper: safe markdown escape for messages ===
function escapeMarkdown(text = "") {
  const str = String(text);
  return str.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
/**
 * Show all game history (admin-style view)
 */
const tipsPagination = {}; // store pagination state per chat

async function handleAllTipsHistory(chatId, page = 1, messageId = null) {
  try {
    // Cache tips for this chat
    if (!tipsPagination[chatId] || !tipsPagination[chatId].games) {
      const res = await apiGet("/api/games/allGame");
      const games = res.data || [];

      // Filter only Hit✅ or Miss❌ games
      const filteredGames = games.filter(
        (g) => g.status === "Hit✅" || g.status === "Miss❌"
      );

      if (!filteredGames.length) {
        return bot.sendMessage(chatId, "📭 <b>No game history found yet.</b>", {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back", callback_data: "admin_panel" }],
              // [{ text: "🔃 Refresh", callback_data: "history" }],
            ],
          },
        });
      }

      tipsPagination[chatId] = { games: filteredGames, page: 1 };
    }

    const { games } = tipsPagination[chatId];
    const totalPages = Math.ceil(games.length / 10);
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    tipsPagination[chatId].page = currentPage;

    const start = (currentPage - 1) * 10;
    const end = start + 10;
    const pageGames = games.slice(start, end);

    let message = `📈 <b>All Tips History</b> (${games.length})\n──────────────────────\n`;
    const reversedGames = [...pageGames].reverse();

    for (let i = 0; i < reversedGames.length; i++) {
      const g = reversedGames[i];
      const date = new Date(g.createdAt);
      const formattedDate = `${date.getDate()}/${date.getMonth() + 1}`;

      message += `\n<b>${
        g.status === "Hit✅" ? "✅ Hit" : "❌ Miss"
      } ${escapeHTML(g.tipTitle)} - ${escapeHTML(
        g.contentAfterPurchase
      )}</b>\n`;
      message += `💰 <b>$${escapeHTML(String(g.tipPrice))} | 📊 ${escapeHTML(
        String(g.oddRatio)
      )} | 📅 ${escapeHTML(formattedDate)}</b>\n`;
      message += `⭐️ ${escapeHTML(
        String(g.purchasedBy.length || 0)
      )} users purchased this tip\n`;

      message += `<blockquote>💸 <b>250₪ turned into ${escapeHTML(
        (250 * g.oddRatio).toLocaleString()
      )}₪ 💸</b></blockquote>\n`;

      if (i < pageGames.length - 1) {
        message += `──────────────────────\n`;
      }
    }

    // Pagination buttons
    const paginationRow = [
      {
        text: "⬅️ Prev",
        callback_data:
          currentPage > 1 ? `tips_history_page_${currentPage - 1}` : "noop",
      },
      {
        text: `📄 ${currentPage}/${totalPages}`,
        callback_data: "noop",
      },
      {
        text: "➡️ Next",
        callback_data:
          currentPage < totalPages
            ? `tips_history_page_${currentPage + 1}`
            : "noop",
      },
    ];

    const controlRow = [
      // { text: "🔃 Refresh", callback_data: "history" },
      { text: "⬅️ Back", callback_data: "main_menu" },
    ];

    const inlineKeyboard = [paginationRow, controlRow];

    // Edit message if already sent, else send new
    if (messageId) {
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    } else {
      await bot.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    }
  } catch (err) {
    console.error("handleAllTipsHistory error:", err.message || err);
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to load tips history. Try again later.",
      { parse_mode: "HTML" }
    );
  }
}

bot.on("successful_payment", async (msg) => {
  const chatId = msg.chat.id;
  const payment = msg.successful_payment;
  console.log("✅ Stars payment received:", payment);

  // Reverse convert to USD
  const totalStars = payment.total_amount;
  const amountUSD = (totalStars / 3846) * 50;

  try {
    // Update backend
    await axios.post(`${BACKEND_URL}/api/auth/deposit`, {
      userId: payment.invoice_payload.split("_")[2],
      amount: amountUSD,
    });

    await bot.sendMessage(
      chatId,
      `🎉 *Payment Successful!*\n\n💰 $${amountUSD.toFixed(
        2
      )} has been added to your account.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("❌ Error updating backend:", err.message);
    await bot.sendMessage(
      chatId,
      "⚠️ Payment succeeded, but balance update failed. Please contact support."
    );
  }

  delete sessions[chatId]; // clean up session
});

// Add pagination handling in your callback_query listener
bot.on("callback_query", async (query) => {
  const { data, message } = query;
  const chatId = message.chat.id;

  try {
    // Handle pagination
    if (data.startsWith("tips_history_page_")) {
      const page = parseInt(data.split("_").pop());
      return handleAllTipsHistory(chatId, page, message.message_id);
    }

    // Ignore “noop” buttons
    if (data === "noop") {
      return bot.answerCallbackQuery(query.id, {
        text: "⏺️ You’re on this page",
      });
    }
  } catch (err) {
    console.error("callback_query error:", err.message);
  }
});
/**
 * View full details of a specific game from history
 */
async function handleGameHistoryDetails(chatId, gameId) {
  try {
    const res = await apiGet(`/api/games/allGame`);
    const games = res.data || [];
    const game = games.find((g) => String(g._id) === String(gameId));

    if (!game) {
      return safeSend(bot, chatId, "⚠️ Game not found.", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Back to History", callback_data: "history" }],
          ],
        },
      });
    }

    // Send image first (if available)
    if (game.image) {
      await bot.sendPhoto(chatId, game.image, {
        caption: `🏆 *${escapeMarkdownV2(game.tipTitle)}*`,
        parse_mode: "MarkdownV2",
      });
    }
    const renderStars = (level) => {
      return "⭐".repeat(Number(level) || 0) || "N/A";
    };
    // Compose message
    const details = `
🏆 *${escapeMarkdownV2(game.tipTitle)}*

💵 *Price:* ₦${escapeMarkdownV2(String(game.tipPrice))}
📈 *Odds:* ${escapeMarkdownV2(String(game.oddRatio))}
🔥 *Confidence:* ${renderStars(game.confidenceLevel) || "N/A"}
📅 *Status:* ${escapeMarkdownV2(game.status || "Pending")}

🏦 *Available On:*
${(game.bettingSites || []).map((s) => `▫️ ${escapeMarkdownV2(s)}`).join("\n")}

━━━━━━━━━━━━━━━━━━━━━━

🧾 *Tip Content:*
${escapeMarkdownV2(game.contentAfterPurchase)}

━━━━━━━━━━━━━━━━━━━━━━
🔒 *Note:*
This tip is exclusive to your account.
Sharing or reposting it may result in restrictions.
`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Back to All Tips", callback_data: "history" }],
        ],
      },
    };

    await safeSend(bot, chatId, details, keyboard);
  } catch (err) {
    console.error("handleGameHistoryDetails error:", err.message || err);
    await safeSend(bot, chatId, "⚠️ Failed to load game details.");
  }
}

// === Main menu sender ===
async function sendMainMenu(chatId, userId, userName, isRetry = false) {
  try {
    const res = await apiGet(`/api/auth/getUserById/${userId}`);
    const user = res.data.user;

    const balance = Number(user?.availableBalance || 0).toFixed(2);
    const role = user?.role || "customer";

    const caption = `
🏆 *Welcome to the Sports Tips System*

👋 Welcome ${user.userName}!

🎯 Professional sports tips from the best experts

💰 *Your balance:* $${balance}

⚠ *Important:* Betting is done on betting sites

🎲 We only provide professional recommendations

💻 Click connect to website below to connect with our website
`;

    const buttons = [
      [
        { text: "💰 My Balance", callback_data: `balance_${user._id}` },
        { text: "🏆 Available Tips", callback_data: "tips" },
      ],
      [{ text: "💳 Deposit Funds", callback_data: "deposit" }],
      [
        { text: "🧾 My Purchases", callback_data: "purchases" },
        { text: "📈 All Tips History", callback_data: "history" },
      ],
      [
        { text: "🆘 Support", callback_data: "support" },
        { text: "📣 Update Channel", url: "https://t.me/Addictedgames2025" },
      ],
      // [{ text: "🔃 Refresh", callback_data: "main_menu" }],
    ];

    if (role === "admin") {
      buttons.push([{ text: "👤 Admin Panel", callback_data: "admin_panel" }]);
    }

    await bot.sendPhoto(
      chatId,
      "https://raw.githubusercontent.com/Favour-111/my-asset/main/image.jpg"
    );

    await bot.sendMessage(chatId, caption, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.warn(`User ${userId} not found. Recreating...`);

      // prevent infinite loop
      if (isRetry) {
        console.error("Already retried once — stopping loop.");
        return await bot.sendMessage(
          chatId,
          "⚠️ Could not recreate your account. Please try /start again."
        );
      }

      try {
        // Clear any stale context
        userContext.delete(chatId);

        // Ensure we have a valid new user
        const newCtx = await ensureUserContext(chatId, {
          first_name: userName,
        });

        if (!newCtx || !newCtx.userId) {
          console.error("ensureUserContext failed to return new userId");
          return await bot.sendMessage(
            chatId,
            "⚠️ Failed to recreate your account. Please try /start again."
          );
        }

        // ✅ Retry only once with the new userId
        return await sendMainMenu(chatId, newCtx.userId, userName, true);
      } catch (createErr) {
        console.error("Failed to recreate user:", createErr);
        return await bot.sendMessage(
          chatId,
          "⚠️ Your account was missing and could not be recreated. Please try /start again."
        );
      }
    }

    console.error("sendMainMenu error:", err.message || err);
    await bot.sendMessage(chatId, "❌ Failed to load menu. Try /start again.");
  }
}

// === Admin stats ===
async function getAdminStats() {
  try {
    const res = await apiGet("/api/games/stats");
    return res.data;
  } catch (err) {
    console.error("getAdminStats error:", err.message || err);
    return { users: 0, tips: 0, activeTips: 0, revenue: 0 };
  }
}

// === Handlers: /start and /admin ===
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const token = match[1]; // may be undefined
  const tgIdStr = chatId.toString();

  try {
    // --- Step 1: Handle token start ---
    if (token) {
      return await bot.sendMessage(
        chatId,
        "👋 Welcome! Click the button below to start and link your account:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🚀 Start / Link Account",
                  callback_data: `link_start_${token}`,
                },
              ],
            ],
          },
        }
      );
    }

    // --- Step 2: Normal start ---
    let ctx = userContext.get(chatId);

    // Try to load user from context or DB
    if (!ctx) {
      const user = await User.findOne({ telegramId: tgIdStr });

      if (user) {
        ctx = {
          userId: user._id,
          balance: user.availableBalance,
          telegramId: tgIdStr,
        };
        userContext.set(chatId, ctx);
      } else {
        // User not found — create a new one
        ctx = await ensureUserContext(chatId, msg.from);
      }
    }

    // --- Step 3: Send main menu ---
    await sendMainMenu(chatId, ctx.userId, msg.from.first_name);
  } catch (err) {
    console.error("Error in /start handler:", err);
    await bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
  }
});

// --- Handle the “Start / Link Account” button ---
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("link_start_")) {
    const token = data.replace("link_start_", "");
    const linkToken = await LinkToken.findOne({ token, used: false });
    if (!linkToken) {
      return bot.answerCallbackQuery(query.id, {
        text: "❌ This link is invalid or expired.",
        show_alert: true,
      });
    }

    const user = await User.findById(linkToken.userId);
    if (!user)
      return bot.answerCallbackQuery(query.id, {
        text: "❌ User not found.",
        show_alert: true,
      });

    user.telegramId = chatId.toString();
    await user.save();

    linkToken.used = true;
    await linkToken.save();

    userContext.set(chatId, {
      userId: user._id,
      balance: user.availableBalance,
      telegramId: chatId.toString(),
    });

    await bot.editMessageText(
      `✅ Telegram successfully linked!\n\nWebsite username: ${user.userName}\nEmail: ${user.email}`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
      }
    );

    // Show main menu after linking
    await sendMainMenu(chatId, user._id, user.userName);
  }
});

bot.onText(/\/connect/, async (msg) => {
  const chatId = msg.chat.id;
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  await LinkToken.create({ token, telegramId: chatId, expiresAt });

  const loginUrl = `${process.env.API}/telegram-login?token=${token}`;
  await bot.sendMessage(chatId, `Click to login to website: ${loginUrl}`);
});
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!ADMIN_ID.includes(userId)) {
    return bot.sendMessage(
      chatId,
      "🚫 You are not authorized to access the admin panel."
    );
  }

  const stats = await getAdminStats();

  const adminText = `
👨‍💼 *Admin Panel*

📊 *Quick Statistics:*
👥 *Users:* ${stats.users}
🏆 *Tips:* ${stats.tips} (Active: ${stats.activeTips})
💵 *Revenue:* $${stats.revenue.toFixed(2)}

🔥 *Active tips right now:* ${stats.activeTips}

Choose an action below:
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ Add Tip", callback_data: "add_tip" },
          { text: "📈 Statistics", callback_data: "view_stats" },
        ],
        [
          { text: "🧾 Manage Tips", callback_data: "manage_tips" },
          { text: "👥 Manage Users", callback_data: "manage_users" },
        ],
        [
          { text: "💰 Add Balance", callback_data: "add_balance" },
          { text: "📢 Broadcast Message", callback_data: "broadcast" },
        ],
        [{ text: "⬅️ Back to Main Menu", callback_data: "main_menu" }],
        // [{ text: "🔃 Refresh Management", callback_data: "admin_panel" }],
      ],
    },
    parse_mode: "Markdown",
  };

  bot.sendMessage(chatId, adminText, keyboard);
});

// === CALLBACK QUERY handler (single centralized) ===
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const from = query.from;
  const data = query.data;

  // Only admin actions require ADMIN_ID check; for user actions we allow normal users
  try {
    // --- Admin-only actions ---
    const adminOnly = [
      "add_tip",
      "view_stats",
      "manage_tips",
      "manage_users",
      "add_balance",
      "broadcast",
      "admin_panel",
    ];
    if (adminOnly.includes(data) && !ADMIN_ID.includes(from.id)) {
      await bot.answerCallbackQuery(query.id, { text: "Unauthorized" });
      return;
    }

    // Small router
    if (data === "tips") return handleShowTips(chatId, from);
    if (data === "add_tip") return startAddGameFlow(chatId);
    if (data === "view_stats") return handleViewStats(chatId);
    if (data === "manage_tips") return handleManageTips(chatId);
    if (data === "purchases") return handlePurchases(chatId, from);
    if (data === "deposit") {
      try {
        // Step 1: Ensure backend user exists
        const ctx = await ensureUserContext(chatId, from);
        const { userId } = ctx;

        // Step 2: Fetch user's current balance
        const userRes = await axios.get(
          `${BACKEND_URL}/api/auth/getUser/${userId}`
        );
        const user = userRes.data?.user;
        const currentBalance = user?.availableBalance || 0;

        // Step 3: Send a structured deposit menu
        const messageText = `
💳 *Add Funds*

💰 *Current balance:* $${currentBalance.toFixed(2)}
💵 *Minimum deposit:* $50
⭐ *Stars rate:* 1 USD = 76.9 ⭐

Select your payment method:
`;

        const inlineKeyboard = {
          inline_keyboard: [
            [
              {
                text: "💎 Crypto Payment",
                callback_data: `deposit_crypto_${userId}`,
              },
            ],
            [
              {
                text: "⭐ Pay with Telegram Stars",
                callback_data: `deposit_stars_${userId}`,
              },
            ],
            [{ text: "❌ Cancel", callback_data: "main_menu" }],
          ],
        };

        await bot.sendMessage(chatId, messageText, {
          parse_mode: "Markdown",
          reply_markup: inlineKeyboard,
        });
      } catch (err) {
        console.error("Deposit flow error:", err.message || err);
        await bot.sendMessage(
          chatId,
          "⚠️ Could not verify your account or fetch balance. Please try again."
        );
      }
    }
    if (data === "toggle_tips") {
      const session = chatSessions[chatId] || { showAllTips: false };
      const newShowAll = !session.showAllTips;

      // Delete old message and reload with new state
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await handleManageTips(chatId, newShowAll);
      await bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("updateTime_")) {
      const gameId = data.split("_")[1];

      // Ask the admin for the new duration
      await bot.sendMessage(chatId, "⏰ Enter new duration (in minutes):");

      // Save session to know which game to update
      chatSessions[chatId] = { gameId, step: "updating_duration" };

      // ✅ Use query.id here
      await bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("deposit_crypto_")) {
      const userId = data.split("_")[2];

      sessions[chatId] = { step: "crypto_deposit", userId };

      const messageText = `
💎 *Add Funds - Crypto*

💵 *Enter amount to add* (minimum $50):

💡 *Example:* 100

After entering the amount you will be redirected to choose cryptocurrency in OxaPay system.
`;

      await bot.sendMessage(chatId, messageText, { parse_mode: "Markdown" });
    }

    // Step 1: User selects to deposit stars
    if (data.startsWith("deposit_stars_")) {
      const userId = data.split("_")[2];
      sessions[chatId] = { userId, step: "awaiting_stars_amount" };

      await bot.sendMessage(
        chatId,
        `
⭐️ *Add Funds - Telegram Stars*

💵 Enter the amount you'd like to add (minimum $50):

💡 *Stars Conversion*
- $50 = 3846 stars  
- $100 = 7691 stars  

Example: \`100\`
      `,
        { parse_mode: "Markdown" }
      );
    }

    // Step 2: Confirm payment
    if (data.startsWith("confirm_stars_")) {
      const userId = data.split("_")[2];
      const session = sessions[chatId];

      if (!session || session.userId !== userId) {
        return bot.sendMessage(chatId, "⚠️ Session expired or invalid.");
      }

      try {
        await bot.sendInvoice(
          chatId,
          "Add Funds - Telegram Stars",
          `Deposit $${session.amount} into your account.`,
          `stars_deposit_${userId}_${Date.now()}`,
          "", // provider_token empty
          "XTR", // currency: Stars
          [{ label: `Deposit $${session.amount}`, amount: session.stars }]
        );
      } catch (err) {
        console.error("❌ Error sending invoice:", err.message);
        await bot.sendMessage(
          chatId,
          "❌ Failed to create Stars payment invoice."
        );
      }
    }

    if (data.startsWith("check_crypto_")) {
      const orderId = data.split("_")[2];

      try {
        await bot.sendMessage(chatId, "⏳ Checking your payment status...");

        const res = await axios.get(
          `${BACKEND_URL}/api/payment/check-status/${orderId}`
        );
        const status = res.data?.status?.toLowerCase();

        if (
          status === "paid" ||
          status === "completed" ||
          status === "success"
        ) {
          // Confirmed ✅
          await bot.sendMessage(
            chatId,
            "✅ *Payment confirmed!* Your balance has been updated successfully.",
            { parse_mode: "Markdown" }
          );

          // Update session & cleanup
          delete sessions[chatId];

          // Optionally refresh user data (if backend supports it)
          try {
            const userRes = await axios.get(
              `${BACKEND_URL}/api/user/${orderId.split("_")[1]}`
            );
            const newBalance = userRes.data?.availableBalance;
            if (newBalance) {
              await bot.sendMessage(
                chatId,
                `💰 *Your new balance:* $${newBalance}`,
                { parse_mode: "Markdown" }
              );
            }
          } catch (err2) {
            console.warn("⚠️ Couldn't fetch updated balance:", err2.message);
          }
        } else if (status === "pending" || status === "waiting") {
          // Not yet confirmed — simulate polling message
          await bot.sendMessage(
            chatId,
            "⌛ Payment not yet confirmed. Please wait a few minutes and click *Check Payment* again.",
            { parse_mode: "Markdown" }
          );
        } else {
          // Unexpected / failed
          await bot.sendMessage(
            chatId,
            "⚠️ Payment not found or failed. Please contact support if you already paid."
          );
        }
      } catch (err) {
        console.error("Check payment error:", err.message);
        await bot.sendMessage(
          chatId,
          "⚠️ Failed to check payment status. Please try again later."
        );
      }
    }

    if (data.startsWith("tip_")) {
      const gameId = data.split("_")[1];
      return handleTipDetails(chatId, gameId);
    }
    if (data === "history") {
      await handleAllTipsHistory(chatId);
      return bot.answerCallbackQuery(query.id);
    }
    // 💠 Handle "Pay Now" click
    if (data.startsWith("crypto_paynow_")) {
      const transactionId = data.split("_")[2];
      const session =
        Object.values(sessions).find(
          (s) =>
            s.transactionId === `crypto_${s.userId}_${transactionId}` ||
            s.transactionId === `crypto_${s.userId}_${Date.now()}`
        ) ||
        Object.values(sessions).find((s) =>
          s.transactionId.includes(transactionId)
        );

      if (!session) {
        return bot.sendMessage(
          chatId,
          "⚠️ Session expired. Please start again."
        );
      }

      const { amount, userId } = session;

      try {
        await bot.sendMessage(
          chatId,
          "⏳ Generating your crypto payment link..."
        );

        const order_id = `deposit_${userId}_${Date.now()}`;
        const res = await axios.post(
          `${BACKEND_URL}/api/payment/create-invoice`,
          {
            amount,
            order_id,
            description: `Deposit by Telegram User ${userId}`,
            email: `tg_${userId}@telegram.local`,
            username: from.username || from.first_name || "Telegram User",
            userId,
          },
          {
            headers: {
              Authorization: `Bearer ${userId}`,
            },
          }
        );

        const payment_url = res.data?.data?.payment_url;
        if (!payment_url)
          throw new Error("No payment URL returned from backend.");

        const inlineKeyboard = {
          inline_keyboard: [
            [{ text: "💠 Open Payment Page", url: payment_url }],
            [
              {
                text: "🔄 Check Payment",
                callback_data: `check_crypto_${order_id}`,
              },
            ],
            [{ text: "❌ Cancel", callback_data: "main_menu" }],
          ],
        };

        await bot.sendMessage(
          chatId,
          `✅ *Payment link created successfully!*\n\nClick *"Open Payment Page"* to complete your crypto deposit.`,
          { parse_mode: "Markdown", reply_markup: inlineKeyboard }
        );

        // Update session
        sessions[chatId] = {
          step: "crypto_payment_pending",
          userId,
          amount,
          order_id,
          payment_url,
        };
      } catch (err) {
        console.error("Create crypto payment error:", err.message);
        if (err.response?.description?.includes("query is too old")) return;
        await bot.sendMessage(
          chatId,
          "⚠️ Failed to create crypto payment link. Please try again later."
        );
      }
    }

    if (data.startsWith("history_")) {
      const gameId = data.split("_")[1];
      await handleGameHistoryDetails(chatId, gameId);
      return bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("update_")) {
      const gameId = data.split("_")[1];

      // Show admin a list of status options
      const statusKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Won", callback_data: `status_${gameId}_Hit✅` }],
            [{ text: "❌ Lost", callback_data: `status_${gameId}_Miss❌` }],
            [{ text: "⏸ Pending", callback_data: `status_${gameId}_Pending` }],
            [{ text: "⬅️ Back to Tip", callback_data: `tip_${gameId}` }],
          ],
        },
      };

      return bot.sendMessage(chatId, "📊 *Select new status for this tip:*", {
        parse_mode: "Markdown",
        ...statusKeyboard,
      });
    }
    if (data.startsWith("status_")) {
      const [_, gameId, status] = data.split("_");

      try {
        // 1️⃣ Update the game status in the backend
        await apiPut(`/api/games/updategameStatus/${gameId}`, {
          gameStatus: status,
        });

        // 2️⃣ Confirm to admin
        await bot.sendMessage(chatId, `✅ *${status}* set for this game!`, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back to Tip", callback_data: `tip_${gameId}` }],
            ],
          },
        });

        // 3️⃣ Fetch the updated game
        const gameRes = await apiGet(`/api/games/${gameId}`);
        const game = gameRes.data;

        if (!game?.purchasedBy?.length) {
          console.log(`ℹ️ No buyers for ${game.tipTitle}`);
          return;
        }

        // 4️⃣ Fetch all users
        const userRes = await apiGet(`/api/auth/getUsers`);
        const allUsers = userRes.data.users || [];

        // 5️⃣ Match buyers
        const buyers = game.purchasedBy
          .map((buyerId) =>
            allUsers.find((u) => String(u._id) === String(buyerId))
          )
          .filter(Boolean);

        if (!buyers.length) {
          console.log("⚠️ No valid buyers with Telegram IDs found.");
          return;
        }

        // 6️⃣ Build result message
        let resultMessage = "";
        if (status === "Hit✅" || status === "Won") {
          resultMessage = `
🎉 *Your tip was a hit!*  

🏆 Tip: ${game.tipTitle || "Unknown Tip"}  
📊 Odds ratio: ${game.oddRatio || "N/A"}  
💰 Price: $${game.tipPrice || "N/A"}  

🎯 Result: ✅ *Won*  

🎉 Congratulations! Want more winning tips?`;
        } else if (status === "Miss❌" || status === "Lost") {
          resultMessage = `
😔 *Result update*  

🏆 Tip: ${game.tipTitle || "Unknown Tip"}  
📊 Odds ratio: ${game.oddRatio || "N/A"}  
💰 Price: $${game.tipPrice || "N/A"}  

🎯 Result: ❌ *Lost*  

📄 Let’s try again with the next tip!`;
        } else {
          resultMessage = `
⏳ *Update: Tip still pending*  

🏆 Tip: ${game.tipTitle || "Unknown Tip"}  
📊 Odds ratio: ${game.oddRatio || "N/A"}  
💰 Price: $${game.tipPrice || "N/A"}  

🎯 Result: ⏸ *Pending*  

We’ll notify you once results are in.`;
        }

        // 7️⃣ Send to each buyer
        let sent = 0;
        for (const buyer of buyers) {
          const tgId = buyer.telegramId || buyer.chatId;
          if (!tgId) continue;

          // ✅ build keyboard here so buyer._id is available
          const userKeyboard = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "🎯 View Tips", callback_data: "tips" },
                  {
                    text: "💰 View Balance",
                    callback_data: `balance_${buyer._id}`,
                  },
                ],
              ],
            },
            parse_mode: "Markdown",
          };

          try {
            await bot.sendMessage(Number(tgId), resultMessage, userKeyboard);
            sent++;
            console.log(`✅ Sent to ${buyer.userName || tgId}`);
          } catch (err) {
            console.warn(
              `❌ Failed to send to ${buyer.userName || tgId}: ${err.message}`
            );
          }

          await new Promise((r) => setTimeout(r, 300)); // avoid flood limits
        }

        console.log(`✅ Sent updates to ${sent}/${buyers.length} buyers.`);
      } catch (err) {
        console.error("⚠️ Error in status_ handler:", err.message);
        await bot.sendMessage(
          chatId,
          "⚠️ Error updating status or notifying users."
        );
      }
    }

    if (data === "manage_users") return handleManageUsers(chatId);
    // 🧠 1. When admin clicks "broadcast"
    if (data === "broadcast") {
      const res = await apiGet("/api/auth/getUsers");
      const users = res.data.users || [];
      const activeCount = users.filter((u) => u.telegramId).length;

      sessions[chatId] = { step: "broadcast_message", totalUsers: activeCount };

      return bot.sendMessage(
        chatId,
        `📨 *Send Message to All Users*\n\n👥 Will be sent to *${activeCount} active users*\n\nEnter your message:`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Cancel", callback_data: "cancel_broadcast" }],
            ],
          },
        }
      );
    }

    // 🧠 3. Handle confirmation
    if (data === "confirm_broadcast_send" && sessions[chatId]) {
      const { message, totalUsers } = sessions[chatId];
      await bot.sendMessage(
        chatId,
        `📤 Broadcasting message to ${totalUsers} users...`
      );

      try {
        const res = await apiGet("/api/auth/getUsers");
        const users = res.data.users || [];

        let success = 0;
        for (const u of users) {
          if (!u.telegramId) continue;
          try {
            await bot.sendMessage(u.telegramId, message);
            success++;
          } catch (e) {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 100)); // avoid rate limits
        }

        await bot.sendMessage(
          chatId,
          `✅ Broadcast complete!\n\n📨 Sent to ${success} out of ${totalUsers} users.`
        );
      } catch (err) {
        console.error("Broadcast error:", err);
        await bot.sendMessage(chatId, "⚠️ Failed to broadcast message.");
      }

      delete sessions[chatId];
      return;
    }

    // 🧠 4. Handle cancel button
    if (data === "cancel_broadcast") {
      delete sessions[chatId];
      return bot.sendMessage(chatId, "❌ Broadcast cancelled.");
    }

    if (data.startsWith("buy_")) {
      const gameId = data.split("_")[1];

      // Fetch game details first
      const gameRes = await apiGet(`/api/games/allGame`);
      const game = (gameRes.data || []).find(
        (g) => String(g._id) === String(gameId)
      );

      if (!game) {
        await bot.sendMessage(chatId, "⚠️ Game not found.");
        return await bot.answerCallbackQuery(query.id);
      }

      const renderStars = (level) => {
        return "⭐".repeat(Number(level) || 0) || "N/A";
      };

      const createdAt = new Date(game.createdAt).getTime();
      const endTime = createdAt + game.duration * 60000;
      const totalDurationMs = game.duration * 60000;

      // Build description
      const buildDescription = (timeLeftMs) => {
        const minutesLeft = Math.ceil(timeLeftMs / 60000);
        const secondsLeft = Math.floor((timeLeftMs % 60000) / 1000);

        // Percentage of time left
        const percentLeft = Math.max(
          Math.min(timeLeftMs / totalDurationMs, 1),
          0
        );

        // Progress bar
        const totalBlocks = 10;
        const filledBlocks = Math.round(percentLeft * totalBlocks);
        const emptyBlocks = totalBlocks - filledBlocks;
        const progressBar = "█".repeat(filledBlocks) + "▒".repeat(emptyBlocks);

        let progressText = "";
        if (timeLeftMs <= 0) {
          progressText = "██████████ (0%) - Expired";
        } else if (minutesLeft <= 30) {
          progressText = `⚠️ ${progressBar} ◒ ${minutesLeft}m (${Math.round(
            percentLeft * 100
          )}%) - Ending soon`;
        } else {
          progressText = `⌛ ${minutesLeft}m ${secondsLeft}s`;
        }

        return `
🏆 *Tip:* ${game.tipTitle}

💵 *Price:* $${String(game.tipPrice)}
📊 *Odds ratio:* ${game.oddRatio}
🔥 *Confidence Level:* ${renderStars(game.confidenceLevel)}

${progressText}

ℹ Buy Game to unlock Content

⚠ *Remember:* Betting is done on betting sites; we only provide recommendations
`;
      };

      // Send initial message
      const msg = await safeSend(
        bot,
        chatId,
        buildDescription(endTime - Date.now()),
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💰 Buy Tip Now",
                  callback_data: `confirmBuy_${game._id}`,
                },
              ],
              [{ text: "⬅️ Back to Tips", callback_data: "tips" }],
            ],
          },
          parse_mode: "MarkdownV2",
        }
      );

      // Update message every second
      const interval = setInterval(async () => {
        const timeLeftMs = endTime - Date.now();

        if (timeLeftMs <= 0) {
          clearInterval(interval);

          // Deactivate the game
          try {
            await apiPost(`/api/games/deactivate/${game._id}`, {
              active: false,
            });
          } catch (err) {
            console.error("Failed to deactivate game:", err.message);
          }
        }