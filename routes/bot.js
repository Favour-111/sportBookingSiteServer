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
      if (!games.length) {
        return bot.sendMessage(chatId, "📭 <b>No game history found yet.</b>", {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back", callback_data: "admin_panel" }],
              [{ text: "🔃 Refresh", callback_data: "history" }],
            ],
          },
        });
      }
      tipsPagination[chatId] = { games, page: 1 };
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
        g.status === "Hit✅"
          ? "✅ Hit"
          : g.status === "Miss❌"
          ? "❌ Miss"
          : "⌛ Pending"
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

    // Pagination buttons (3 centered)
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
      { text: "🔃 Refresh", callback_data: "history" },
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
async function sendMainMenu(chatId, userId, userName) {
  try {
    const res = await apiGet(`/api/auth/getUserById/${userId}`);
    const user = res.data.user;
    const balance =
      (user && Number(user.availableBalance || 0).toFixed(2)) || "0.00";
    const role = user && user.role ? user.role : "customer";

    const caption = `
🏆 *Welcome to the Sports Tips System*

👋 Welcome ${user.userName}!

🎯 Professional sports tips from the best experts

💰 *Your balance:* $${balance}

⚠ *Important:* Betting is done on betting sites

🎲 We only provide professional recommendations

💻 Click connect to website below to connect with our website
`;

    // Buttons
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
      [{ text: "🔃 Refresh", callback_data: "main_menu" }],
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
    if (token) {
      // --- Step 1: Send “Start / Link Account” button ---
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

    // --- Normal start without token ---
    let ctx = userContext.get(chatId);
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
        ctx = await ensureUserContext(chatId, msg.from);
      }
    }

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
        [{ text: "🔃 Refresh Management", callback_data: "admin_panel" }],
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
            [{ text: "✅ Won", callback_data: `status_${gameId}_Won` }],
            [{ text: "❌ Lost", callback_data: `status_${gameId}_Lost` }],
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
        const res = await apiPut(`/api/games/updategameStatus/${gameId}`, {
          gameStatus: status,
        });

        const msg = res.data?.message || "✅ Status updated successfully!";
        await bot.sendMessage(
          chatId,
          `✅ *${status}* set for game!\n\n${msg}`,
          {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Back to Tip", callback_data: `tip_${gameId}` }],
              ],
            },
          }
        );
      } catch (err) {
        const msg =
          err.response?.data?.message ||
          "⚠️ Could not update status. Try again later.";
        await bot.sendMessage(chatId, msg);
      }
    }

    if (data === "manage_users") return handleManageUsers(chatId);
    if (data === "broadcast") {
      sessions[chatId] = { step: "broadcast" };
      return bot.sendMessage(chatId, "📢 Send the message to broadcast:");
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

💳 *Your balance:* : $0.00

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

        try {
          await bot.editMessageText(buildDescription(timeLeftMs), {
            chat_id: chatId,
            message_id: msg.message_id,
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
          });
        } catch (err) {
          // Ignore errors if message deleted
        }
      }, 1000); // every second

      await bot.answerCallbackQuery(query.id);
    }

    // Handle the actual purchase when "Buy Tip Now" is pressed
    if (data.startsWith("confirmBuy_")) {
      await handleBuyTip(
        query,
        chatId,
        from,
        data.replace("confirmBuy_", "buy_")
      );
    }

    if (data.startsWith("tip_"))
      return handleViewTipDetails(chatId, data.split("_")[1]);
    if (data.startsWith("toggle_"))
      return handleToggleTip(chatId, data.split("_")[1]);
    if (data.startsWith("notify_")) {
      const gameId = data.split("_")[1];
      await handleNotifyBuyers(chatId, gameId);
      return;
    }

    // When admin selects a user from the list

    // balance show
    if (data.startsWith("balance_")) {
      const userId = data.split("_")[1];
      return handleShowBalance(chatId, userId);
    }
    if (data.startsWith("select_user_")) {
      const userId = data.replace("select_user_", "");
      sessions[chatId] = { flow: "add_balance", step: 1, userId };

      try {
        const response = await axios.get(
          `${BACKEND_URL}/api/auth/getUser/${userId}`
        );
        const userData = response.data;
        const user =
          userData?.user ||
          userData?.data?.user ||
          userData?.data ||
          userData ||
          {};

        const s = sessions[chatId];
        s.userData = user;
        s.step = 2;

        const cancelButton = {
          reply_markup: {
            inline_keyboard: [
              [{ text: "❌ Cancel", callback_data: "admin_panel" }],
            ],
          },
        };

        const message = `
💰 *Add balance to user*

👤 *User:* ${user.userName || "Unknown"} (@${user.userName || "N/A"})
💳 *Current balance:* $${Number(user.availableBalance || 0).toFixed(2)}

💵 *Enter amount to add (in USD):*
`;

        return bot.sendMessage(chatId, message, {
          parse_mode: "Markdown",
          ...cancelButton,
        });
      } catch (err) {
        console.error(
          "Error fetching user info:",
          err.response?.data || err.message
        );
        return bot.sendMessage(chatId, "⚠️ Failed to load user details.");
      }
    }

    // When admin clicks "Add Balance"
    if (data === "add_balance") {
      try {
        const res = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
        const users = res.data.users || [];

        if (!users.length) {
          return bot.sendMessage(chatId, "⚠️ No users found.");
        }

        const inlineKeyboard = {
          inline_keyboard: users.map((u) => [
            {
              text: `👤 ${u.userName || u.email} ($${u.availableBalance || 0})`,
              callback_data: `select_user_${u._id}`,
            },
          ]),
        };

        await bot.sendMessage(chatId, "👥 *Select a user to add balance to:*", {
          parse_mode: "Markdown",
          reply_markup: inlineKeyboard,
        });
      } catch (err) {
        console.error("Error fetching users:", err.message);
        await bot.sendMessage(chatId, "⚠️ Failed to fetch user list.");
      }
    }
    if (data.startsWith("confirm_add_balance_")) {
      const userId = data.replace("confirm_add_balance_", "");
      const s = sessions[chatId];

      if (!s || s.userId !== userId) {
        return bot.sendMessage(chatId, "⚠️ Session expired or invalid.");
      }

      try {
        // fetch response (raw)
        const { data: resp } = await axios.get(
          `${BACKEND_URL}/api/auth/getUser/${userId}`
        );

        // normalize to the actual user object no matter the response shape
        const userObj = resp?.user ?? resp?.data ?? resp;

        console.log("🔍 getUser response:", JSON.stringify(resp)); // debug - remove in prod
        console.log("🔍 resolved userObj:", JSON.stringify(userObj));

        // extract telegram id from the actual user object
        const userTelegramId = userObj?.telegramId
          ? Number(userObj.telegramId)
          : null;

        // Update balance in backend
        await axios.post(`${BACKEND_URL}/api/auth/deposit`, {
          userId: s.userId,
          amount: s.amount,
        });

        // Notify admin
        await bot.sendMessage(
          chatId,
          `✅ Successfully added *$${s.amount.toFixed(2)}* to *${
            s.userData?.name || userObj.userName || "the user"
          }*'s account.`,
          { parse_mode: "Markdown" }
        );

        // Notify user
        if (userTelegramId) {
          const mainMenuBtn = {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
              ],
            },
          };

          await bot.sendMessage(
            userTelegramId,
            `
💸 *Balance Update*

🎉 *Good news!*  
An amount of *$${s.amount.toFixed(2)}* has been added to your account.

💳 *New Balance:* will update on your next refresh.

🕐 You can now continue using your account.
        `,
            { parse_mode: "Markdown", ...mainMenuBtn }
          );

          console.log(
            `✅ Notified user ${
              userObj.userName || userId
            } (Telegram ID: ${userTelegramId})`
          );
        } else {
          console.log(
            `⚠️ No telegramId found for user ${userObj.userName || userId} (${
              userObj.telegramId ?? "none"
            })`
          );
        }
      } catch (err) {
        console.error(
          "❌ Error adding balance:",
          err.response?.data || err.message
        );
        await bot.sendMessage(chatId, "❌ Failed to update balance.");
      }

      delete sessions[chatId];
    }

    // back navigation
    if (data === "admin_panel" || data === "back_admin") {
      try {
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
              [{ text: "🔃 Refresh Management", callback_data: "admin_panel" }],
            ],
          },
          parse_mode: "Markdown",
        };

        await bot.sendMessage(chatId, adminText, keyboard);
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Failed to load admin panel.");
      }
    }
    if (data === "main_menu") {
      const chatId = query.message.chat.id;
      try {
        const ctx = await ensureUserContext(chatId, query.from);
        await sendMainMenu(chatId, ctx.userId, query.from.first_name);
      } catch (err) {
        console.error("main_menu error:", err.message || err);
        await bot.sendMessage(
          chatId,
          "❌ Could not complete startup. Please try again later."
        );
      }
    }
    if (data === "manage_tips")
      return bot.emit("text", { chat: { id: chatId }, text: "/admin" });

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("callback_query error:", err.message || err);
    await bot.sendMessage(
      chatId,
      "⚠️ An error occurred while processing this action."
    );
  }
  // Handle skip image
  if (data === "skip_image") {
    const session = sessions[chatId];
    if (session && session.flow === "add_game" && session.step === 4) {
      session.data.image = null;
      session.step = 5;

      const starsKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⭐  (1 Star)", callback_data: "star_1" }],
            [{ text: "⭐⭐  (2 Stars)", callback_data: "star_2" }],
            [{ text: "⭐⭐⭐  (3 Stars)", callback_data: "star_3" }],
            [{ text: "⭐⭐⭐⭐  (4 Stars)", callback_data: "star_4" }],
            [{ text: "⭐⭐⭐⭐⭐  (5 Stars)", callback_data: "star_5" }],
            [{ text: "❌ Cancel & Back", callback_data: "admin_panel" }],
          ],
        },
      };
      return bot.sendMessage(
        chatId,
        "🔥 Choose *Confidence Level* (1–5 Stars):",
        {
          parse_mode: "Markdown",
          ...starsKeyboard,
        }
      );
    }
  }

  // Handle star rating selection
  if (data.startsWith("star_")) {
    const level = Number(data.split("_")[1]);
    const session = sessions[chatId];
    if (session && session.flow === "add_game") {
      session.data.confidenceLevel = level;
      session.step = 6;
      return bot.sendMessage(chatId, "⏱ Enter *Duration (mins)*:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Cancel & Back", callback_data: "admin_panel" }],
          ],
        },
      });
    }
  }
});

async function handleShowTips(chatId, from) {
  try {
    const ctx = await ensureUserContext(chatId, from);
    const userId = ctx.userId;

    // Fetch all active games
    const res = await apiGet("/api/games/allGame");
    const games = (res.data || []).filter((g) => g.active);

    if (!games.length) {
      return bot.sendMessage(
        chatId,
        "⚠ No active tips available at the moment.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back to Main Menu", callback_data: "main_menu" }],
            ],
          },
        }
      );
    }

    // Get user data to know which tips they've already bought
    const userRes = await apiGet(`/api/auth/getUserById/${userId}`);
    const purchasedGameIds = (userRes.data?.user?.betHistory || []).map((b) =>
      String(b.gameId)
    );

    const renderStars = (level) => {
      const stars = "⭐".repeat(Number(level) || 0);
      return stars || "N/A";
    };

    let tipsMessage = "🏆 *Available Tips*";

    // Construct message text
    games.forEach((game) => {
      const isBought = purchasedGameIds.includes(String(game._id));
    });

    // Build inline keyboard
    const buttons = games.map((game) => {
      const isBought = purchasedGameIds.includes(String(game._id));
      if (isBought) {
        return [
          {
            text: `✅ ${game.tipPrice} - $${game.tipPrice} | Odds: ${game.oddRatio} (Bought)`,
            callback_data: `view_${game._id}`, // maybe let them view it again
          },
        ];
      } else {
        return [
          {
            text: `🏆${game.tipPrice} - $${game.tipPrice} | Odds: ${game.oddRatio}`,
            callback_data: `buy_${game._id}`,
          },
        ];
      }
    });

    // Add back button
    buttons.push([
      { text: "⬅️ Back to Main Menu", callback_data: "main_menu" },
    ]);

    // Send message
    await bot.sendMessage(chatId, tipsMessage, {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: buttons },
    });
  } catch (err) {
    console.error("handleShowTips error:", err.message || err);
    await bot.sendMessage(chatId, "❌ Failed to fetch tips.");
  }
}

async function handlePurchases(chatId, from) {
  try {
    const ctx = await ensureUserContext(chatId, from);
    const userId = ctx.userId;

    const res = await apiGet(`/api/auth/getUserById/${userId}`);
    const user = res.data?.user;

    // 🧾 Handle empty purchases
    if (
      !user ||
      !Array.isArray(user.betHistory) ||
      user.betHistory.length === 0
    ) {
      const msg =
        "📭 <b>You have no purchases yet.</b>\n\nStart by buying a tip to see it here!";
      const kb = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬅️ Back to Tips", callback_data: "tips" }],
          ],
        },
      };
      return bot.sendMessage(chatId, msg, {
        parse_mode: "HTML",
        ...kb,
      });
    }

    // 🧾 Header
    let message = `🧾 <b>Your Purchases (${user.betHistory.length})</b>\n─────────────────\n`;

    // 🧮 Loop through bets
    for (let i = 0; i < user.betHistory.length; i++) {
      const bet = user.betHistory[i];
      const isLast = i === user.betHistory.length - 1;

      message += `\n\n🏆 <b>${escapeHTML(
        bet.gameName || "Untitled Tip"
      )}</b>\n`;
      message += `💰 <b>${escapeHTML(
        String(bet.tipPrice)
      )}</b> | 📊 <b>Odds:</b> ${escapeHTML(String(bet.tipOdd || "N/A"))}\n`;
      message += `📅 <b>Date:</b> ${escapeHTML(
        new Date(bet.gameDate).toLocaleString()
      )}\n`;
      message += `📊 <b>Status:</b> ${escapeHTML(bet.status || "Pending")}\n`;

      // Divider inside blockquote (except for last one)
      if (!isLast) {
        message += `──────────────────\n`;
      }
    }

    // 🧭 Inline keyboard
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Refresh", callback_data: "purchases" }],
          [{ text: "🏆 More Tips", callback_data: "tips" }],
          [{ text: "⬅️ Back", callback_data: "main_menu" }],
        ],
      },
    };

    await bot.sendMessage(chatId, message, {
      parse_mode: "HTML",
      ...keyboard,
    });
  } catch (err) {
    console.error(
      "handlePurchases error:",
      err?.response?.data || err.message || err
    );
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to load your purchases. Please try again later.",
      { parse_mode: "HTML" }
    );
  }
}

async function handleViewTipDetails(chatId, gameId) {
  try {
    const res = await apiGet("/api/games/allGame");
    const games = res.data || [];
    const selected = games.find((g) => String(g._id) === String(gameId));

    if (!selected) {
      return bot.sendMessage(chatId, "⚠️ Game not found.");
    }

    const renderStars = (level) => {
      return "⭐".repeat(Number(level) || 0) || "N/A";
    };

    const details =
      `🏆 *${escapeMarkdown(selected.tipTitle)}*\n\n` +
      `💵 Price: $${escapeMarkdown(selected.tipPrice)}\n` +
      `📈 Odds: ${escapeMarkdown(selected.oddRatio)}\n` +
      `🎯 Confidence: ${escapeMarkdown(
        renderStars(selected.confidenceLevel)
      )}\n\n` +
      `📝 ${escapeMarkdown(
        selected.contentAfterPurchase || "No description provided."
      )}`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: selected.active ? "🔴 Deactivate" : "🟢 Activate",
            callback_data: `toggle_${selected._id}`,
          },
          {
            text: "📢 Notify Buyers",
            callback_data: `notify_${selected._id}`,
          },
        ],
        [{ text: "⬅️ Back to Tips", callback_data: "tips" }],
      ],
    };

    if (selected.image) {
      await bot.sendPhoto(chatId, selected.image, {
        caption: details,
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      });
    } else {
      await bot.sendMessage(chatId, details, {
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      });
    }
  } catch (err) {
    console.error("handleViewTipDetails error:", err);
    await bot.sendMessage(chatId, "⚠️ Error fetching tip details.");
  }
}

// ============================
// NOTIFY BUYERS
// ============================
async function handleNotifyBuyers(chatId, gameId) {
  try {
    const res = await apiGet("/api/games/allGame");
    const games = res.data || [];
    const selected = games.find((g) => String(g._id) === String(gameId));

    if (!selected) {
      return bot.sendMessage(chatId, "⚠️ Game not found.", {
        parse_mode: "HTML",
      });
    }

    const buyers = selected.purchasedBy || [];

    // 🔍 Check if buyers are valid Telegram IDs
    const validBuyers = buyers.filter((id) => /^\d+$/.test(String(id)));

    if (!validBuyers.length) {
      return bot.sendMessage(
        chatId,
        "📭 <b>No buyers found for this tip.</b>",
        {
          parse_mode: "HTML",
        }
      );
    }

    const message = `
📢 <b>Update on your purchased tip!</b>

🏆 <b>${escapeHTML(selected.tipTitle)}</b>
💵 <b>Price:</b> $${escapeHTML(String(selected.tipPrice))}
📈 <b>Odds:</b> ${escapeHTML(String(selected.oddRatio))}
🎯 <b>Confidence:</b> ${"⭐".repeat(Number(selected.confidenceLevel) || 0)}

🕕 <b>Duration:</b> ${escapeHTML(String(selected.duration || "N/A"))} mins
📊 <b>Status:</b> ${selected.active ? "🟢 Active" : "🔴 Inactive"}

──────────────────────────────

📝 <b>Content:</b>
${escapeHTML(selected.contentAfterPurchase || "No details provided.")}
`;

    // Send notifications in parallel
    const results = await Promise.allSettled(
      validBuyers.map(async (userId) => {
        try {
          if (selected.image) {
            await bot.sendPhoto(userId, selected.image, {
              caption: message,
              parse_mode: "HTML",
            });
          } else {
            await bot.sendMessage(userId, message, { parse_mode: "HTML" });
          }
        } catch (err) {
          throw new Error(`Failed for ${userId}: ${err.message}`);
        }
      })
    );

    // Count results
    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.filter((r) => r.status === "rejected").length;

    if (failCount > 0) {
      console.warn(
        "Failed to send to some buyers:",
        results.filter((r) => r.status === "rejected")
      );
    }

    await bot.sendMessage(
      chatId,
      `✅ <b>Notification sent to ${successCount} buyer(s).</b>` +
        (failCount ? `\n⚠️ Failed to reach ${failCount} users.` : ""),
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("handleNotifyBuyers error:", err);
    await bot.sendMessage(chatId, "⚠️ Failed to notify buyers.", {
      parse_mode: "HTML",
    });
  }
}

async function handleViewStats(chatId) {
  try {
    const [gameStatsRes, userRes] = await Promise.all([
      axios.get(`${BACKEND_URL}/api/games/stats`),
      axios.get(`${BACKEND_URL}/api/auth/getUsers`),
    ]);

    const stats = gameStatsRes.data || {};
    const users = userRes.data.users || [];

    const totalUsers = users.length;
    const activeUsers = users.filter((u) => u.active).length;
    const blockedUsers = totalUsers - activeUsers;
    const totalTips = stats.tips || 0;
    const activeTips = stats.activeTips || 0;
    const totalRevenue = stats.revenue || 0;
    const totalPurchases = users.reduce(
      (sum, u) => sum + (u.betHistory?.length || 0),
      0
    );
    const totalSystemBalance = users.reduce(
      (sum, u) => sum + (u.availableBalance || 0),
      0
    );

    const statsText = `
📊 *Detailed Statistics*

👥 *Users:*
- Total users: ${totalUsers}
- Blocked users: ${blockedUsers}
- Active users: ${activeUsers}

🏆 *Tips:*
- Total tips: ${totalTips}
- Active tips: ${activeTips}

💰 *Revenue:*
- Total purchases: ${totalPurchases}
- Total revenue: $${totalRevenue.toFixed(2)}

💳 *Balances:*
- Total system balance: $${totalSystemBalance.toFixed(2)}
`;

    await bot.sendMessage(chatId, statsText, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }],
        ],
      },
    });
  } catch (err) {
    console.error("⚠️ Error fetching statistics:", err.message);
    bot.sendMessage(chatId, "⚠️ Failed to fetch detailed statistics.");
  }
}

async function handleToggleTip(chatId, gameId) {
  try {
    const res = await apiPut(`/api/games/${gameId}/toggle-active`);
    await bot.sendMessage(chatId, `✅ ${res.data.message || "Tip toggled"}`);
  } catch (err) {
    console.error("handleToggleTip error:", err.message || err);
  }
}

async function handleShowBalance(chatId, userId) {
  try {
    const res = await apiGet(`/api/auth/getUserById/${userId}`);
    const user = res.data.user;
    const balance =
      (user && Number(user.availableBalance || 0).toFixed(2)) || "0.00";
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Add Funds", callback_data: `deposit_${userId}` }],
          [{ text: "⬅ Back", callback_data: `main_menu` }],
        ],
      },
    };
    await bot.sendMessage(chatId, `💰 Balance: $${balance}`, keyboard);
  } catch (err) {
    console.error("handleShowBalance error:", err.message || err);
    await bot.sendMessage(chatId, "❌ Failed to fetch balance.");
  }
}

// === Buy tip flow: FIXED to reliably obtain userId ===
async function handleBuyTip(query, chatId, from, data) {
  const gameId = data.split("_")[1];
  try {
    const ctx = await ensureUserContext(chatId, from);
    const userId = ctx.userId;

    // ✅ Get latest balance
    const balanceRes = await apiGet(`/api/auth/getUserById/${userId}`);
    const latestBalance = Number(balanceRes.data?.user?.availableBalance || 0);
    ctx.balance = latestBalance;
    userContext.set(chatId, ctx);

    const userBalance = latestBalance;
    console.log("🟡 Processing Buy:", { gameId, userId, userBalance });

    // ✅ Fetch game details
    const gameRes = await apiGet(`/api/games/allGame`);
    const game = (gameRes.data || []).find(
      (g) => String(g._id) === String(gameId)
    );

    if (!game) {
      await bot.sendMessage(chatId, "⚠️ Game not found.");
      return await bot.answerCallbackQuery(query.id);
    }

    const tipPrice = Number(game.tipPrice);

    // ✅ Check balance
    if (userBalance < tipPrice) {
      console.warn(
        `❌ Insufficient funds: user ${userId} has $${userBalance}, needs $${tipPrice}`
      );

      const msg = `
❌ <b>Not enough balance!</b>

💰 <b>Your balance:</b> $${userBalance.toFixed(2)}
💵 <b>Tip price:</b> $${tipPrice.toFixed(2)}

Please <b>deposit funds</b> to continue.
`;

      const depositKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Deposit Now", callback_data: "deposit" }],
            [{ text: "⬅️ Back to Tips", callback_data: "tips" }],
          ],
        },
      };

      await bot.sendMessage(chatId, msg, {
        parse_mode: "HTML",
        ...depositKeyboard,
      });
      return await bot.answerCallbackQuery(query.id);
    }

    // ✅ Proceed with purchase
    console.log("✅ Sufficient balance. Proceeding purchase...");

    const buyRes = await apiPut(`/api/games/${gameId}/buy`, { userId });
    const purchasedGame = buyRes.data.game;
    if (!purchasedGame) throw new Error("Game not found in buy response");

    // ✅ Update backend
    await apiPut(`/api/games/${gameId}/increment-current-limit`);
    await apiPost(`/api/auth/updateBalance`, { userId, amount: tipPrice });
    await apiPut(`/api/auth/addBetHistory/${userId}`, {
      gameContent: purchasedGame.contentAfterPurchase,
      gameName: purchasedGame.tipTitle,
      gameDate: purchasedGame.createdAt,
      gameId: purchasedGame._id,
      tipOdd: purchasedGame.oddRatio,
      image: purchasedGame.image,
      tipPrice,
      status: "Pending",
    });

    // ✅ Update local balance
    ctx.balance = userBalance - tipPrice;
    userContext.set(chatId, ctx);

    const renderStars = (level) => {
      return "⭐".repeat(Number(level) || 0) || "N/A";
    };

    // ✅ Success message (HTML)
    const reply = `
✅ <b>Purchase Successful!</b>

🧾 <b>Game Details</b>
──────────────
🎯 <b>Tip:</b> ${escapeHTML(purchasedGame.tipTitle)}
💵 <b>Price:</b> $${escapeHTML(String(tipPrice))}
📊 <b>Odds:</b> ${escapeHTML(String(purchasedGame.oddRatio))}
🔥 <b>Confidence:</b> ${renderStars(purchasedGame.confidenceLevel)}

🏦 <b>Available On:</b>\n
${(purchasedGame.bettingSites || [])
  .map((site) => `• ${escapeHTML(site)}`)
  .join("\n")}

📅 <b>Date:</b> ${escapeHTML(new Date().toLocaleString())}
💰 <b>Remaining Balance:</b> $${escapeHTML(ctx.balance.toFixed(2))}
──────────────

🧠 <b>Tip Content:</b>\n
${escapeHTML(purchasedGame.contentAfterPurchase)}

───────────────
⚠️ <b>Important Instructions:</b>\n
🎲 Place bet on the betting sites listed above\n
🔐 This content was purchased by you and is for your use only\n
🚫 Do not share this content with others\n\n
📞 In case of an issue or game cancelation, please contact support.
`;
    const replyMarkup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Back to All Tips", callback_data: "tips" }],
          [{ text: "💰 My Purchase", callback_data: "purchases" }],
        ],
      },
    };

    // ✅ Send photo or text
    if (purchasedGame.image) {
      await bot.sendPhoto(chatId, purchasedGame.image, {
        caption: reply,
        parse_mode: "HTML",
        ...replyMarkup,
      });
    } else {
      await bot.sendMessage(chatId, reply, {
        parse_mode: "HTML",
        ...replyMarkup,
      });
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error(
      "❌ handleBuyTip error:",
      err.response?.data || err.message || err
    );
    await bot.sendMessage(
      chatId,
      "❌ Purchase failed. Please check your balance or try again later."
    );
    await bot.answerCallbackQuery(query.id);
  }
}

// Escape helper (HTML safe)
// === Message handler for sessions (broadcast, add_balance, add_game flow) ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return; // ignore commands

  const session = chatSessions[chatId] || sessions[chatId];
  if (!session) return;

  try {
    if (session.step === "updating_duration") {
      const newDuration = parseInt(text);
      if (isNaN(newDuration) || newDuration <= 0) {
        return bot.sendMessage(
          chatId,
          "⚠️ Please enter a valid number for duration."
        );
      }

      try {
        await axios.post(
          `${BACKEND_URL}/api/games/update-duration/${session.gameId}`,
          { duration: newDuration }
        );

        await bot.sendMessage(
          chatId,
          `✅ Duration updated to ${newDuration} minutes.`
        );
      } catch (err) {
        console.error(err.response?.data || err.message);
        await bot.sendMessage(chatId, "❌ Failed to update duration.");
      }

      // Clear session
      delete chatSessions[chatId];
    }

    if (session.step === "awaiting_stars_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 50) {
        return bot.sendMessage(
          chatId,
          "⚠️ Please enter a valid amount (minimum $50)."
        );
      }

      // Convert USD to Stars
      const stars = Math.round((amount / 50) * 3846);
      session.amount = amount;
      session.stars = stars;
      session.step = "awaiting_stars_confirmation";

      const confirmButtons = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `✅ Pay ${stars} Stars ($${amount})`,
                callback_data: `confirm_stars_${session.userId}`,
              },
            ],
            [{ text: "❌ Cancel", callback_data: "cancel_stars" }],
          ],
        },
      };

      await bot.sendMessage(
        chatId,
        `
💫 *Add Funds Confirmation*

Add *$${amount.toFixed(2)}* to your balance  
(using *${stars} stars*).

Click below to complete payment:
      `,
        { parse_mode: "Markdown", ...confirmButtons }
      );
    }
    // === 💰 CRYPTO DEPOSIT FLOW ===
    if (session.step === "crypto_deposit") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 50) {
        return bot.sendMessage(
          chatId,
          "❌ Invalid amount. Minimum deposit is *$50.* Please try again.",
          { parse_mode: "Markdown" }
        );
      }

      const transactionId = `crypto_${session.userId}_${Date.now()}`;
      sessions[chatId] = {
        step: "crypto_pending_confirmation",
        userId: session.userId,
        amount,
        transactionId,
      };

      const messageText = `
💰 *Crypto Payment - $${amount.toFixed(2)}*

🆔 *Transaction ID:* \`${transactionId}\`
⏰ *Expires in:* 30 minutes

💡 *Instructions:*
1️⃣ Click *"Pay Now"* below  
2️⃣ Choose your preferred cryptocurrency  
3️⃣ Send payment from your wallet  
4️⃣ Come back here and click *"Check Payment"*

⚠️ *Important:* Don't close this message until payment is completed!
`;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: "💠 Pay Now",
              callback_data: `crypto_paynow_${transactionId}`,
            },
          ],
          [{ text: "❌ Cancel", callback_data: "main_menu" }],
        ],
      };

      await bot.sendMessage(chatId, messageText, {
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      });

      return; // ✅ stop here (don’t continue to other flows)
    }

    if (session.flow === "add_balance") {
      const s = session;

      const cancelButton = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "❌ Cancel", callback_data: "admin_panel" }],
          ],
        },
      };

      switch (s.step) {
        case 1: {
          // Fetch user info
          const { data } = await axios.get(
            `${BACKEND_URL}/api/auth/getUser/${s.userId}`
          );
          const user = data.user;
          s.userData = user;
          s.step = 2;

          const message = `
💰 *Add balance to user*

👤 *User:* ${user.name || "Unknown"} (@${user.username || "N/A"})
💳 *Current balance:* $${Number(user.availableBalance || 0).toFixed(2)}

💵 *Enter amount to add (in USD):*
`;

          return bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            ...cancelButton,
          });
        }

        case 2: {
          const amount = parseFloat(text.replace(/[^0-9.]/g, ""));
          if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(
              chatId,
              "❌ Invalid amount. Enter a positive number.",
              cancelButton
            );
          }

          s.amount = amount;
          s.step = 3;

          const newBalance = (Number(s.userData.balance || 0) + amount).toFixed(
            2
          );

          const confirmText = `
⚠️ *Confirm Balance Addition*

👤 *User:* ${s.userData.name || "Unknown"} (@${s.userData.username || "N/A"})
💰 *Amount to add:* $${amount.toFixed(2)}
💳 *Current balance:* $${Number(s.userData.balance || 0).toFixed(2)}
📄 *Balance after addition:* $${newBalance}

❓ Are you sure you want to add this balance?
`;

          const confirmKeyboard = {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ Confirm",
                    callback_data: `confirm_add_balance_${s.userId}`,
                  },
                  { text: "❌ Cancel", callback_data: "admin_panel" },
                ],
              ],
            },
          };

          return bot.sendMessage(chatId, confirmText, {
            parse_mode: "Markdown",
            ...confirmKeyboard,
          });
        }
      }
    }
    // === 📢 BROADCAST FLOW ===
    if (session.step === "broadcast") {
      await bot.sendMessage(chatId, "📤 Broadcasting message...");
      const { data } = await apiGet("/api/auth/getUsers");
      const users = data.users || [];

      for (const u of users) {
        try {
          await bot.sendMessage(u.telegramId || ADMIN_ID, text);
        } catch (e) {
          /* ignore failures */
        }
      }

      await bot.sendMessage(chatId, "✅ Broadcast complete!");
      delete sessions[chatId];
      return;
    }

    // === 🎮 ADD GAME FLOW ===
    if (session.flow === "add_game") {
      const s = session;

      // Cancel helper
      const cancelButton = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "❌ Cancel & Back to Admin",
                callback_data: "admin_panel",
              },
            ],
          ],
        },
      };

      switch (s.step) {
        case 1:
          s.data.tipTitle = text;
          s.step = 2;
          return bot.sendMessage(chatId, "💰 Enter the *Price*:", {
            parse_mode: "Markdown",
            ...cancelButton,
          });

        case 2:
          s.data.tipPrice = Number(text);
          if (isNaN(s.data.tipPrice)) {
            return bot.sendMessage(
              chatId,
              "❌ Invalid price. Please enter a number."
            );
          }
          s.step = 3;
          return bot.sendMessage(chatId, "📈 Enter the *Odd Ratio*:", {
            parse_mode: "Markdown",
            ...cancelButton,
          });

        case 3:
          s.data.oddRatio = Number(text);
          if (isNaN(s.data.oddRatio)) {
            return bot.sendMessage(
              chatId,
              "❌ Invalid ratio. Please enter a number."
            );
          }
          s.step = 4;
          return bot.sendMessage(
            chatId,
            "🖼️ Enter *Image URL* or click *Skip*:",
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "⏭ Skip Image", callback_data: "skip_image" }],
                  [{ text: "❌ Cancel & Back", callback_data: "admin_panel" }],
                ],
              },
            }
          );

        case 4:
          s.data.image = text;
          s.step = 5;

          // Confidence level (stars)
          const starsKeyboard = {
            reply_markup: {
              inline_keyboard: [
                [{ text: "⭐  (1 Star)", callback_data: "star_1" }],
                [{ text: "⭐⭐  (2 Stars)", callback_data: "star_2" }],
                [{ text: "⭐⭐⭐  (3 Stars)", callback_data: "star_3" }],
                [{ text: "⭐⭐⭐⭐  (4 Stars)", callback_data: "star_4" }],
                [{ text: "⭐⭐⭐⭐⭐  (5 Stars)", callback_data: "star_5" }],
                [{ text: "❌ Cancel & Back", callback_data: "admin_panel" }],
              ],
            },
          };
          return bot.sendMessage(
            chatId,
            "🔥 Choose *Confidence Level* (1–5 Stars):",
            {
              parse_mode: "Markdown",
              ...starsKeyboard,
            }
          );

        case 5:
          s.step = 6;
          return bot.sendMessage(chatId, "⏱ Enter *Duration (mins)*:", {
            parse_mode: "Markdown",
            ...cancelButton,
          });

        case 6:
          s.data.duration = Number(text);
          if (isNaN(s.data.duration)) {
            return bot.sendMessage(
              chatId,
              "❌ Invalid duration. Please enter a number."
            );
          }
          s.step = 7;
          return bot.sendMessage(
            chatId,
            "🏦 Enter *Betting Sites* (comma separated):",
            {
              parse_mode: "Markdown",
              ...cancelButton,
            }
          );

        case 7:
          s.data.bettingSites = text.split(",").map((t) => t.trim());
          s.step = 8;
          return bot.sendMessage(chatId, "📝 Enter *Content After Purchase*:", {
            parse_mode: "Markdown",
            ...cancelButton,
          });

        case 8:
          s.data.contentAfterPurchase = text;
          s.data.purchaseLimit = s.data.purchaseLimit || 100;

          try {
            await apiPost(`/api/games/add`, s.data);
            global.lastAddedGame = s.data;

            await bot.sendMessage(
              chatId,
              `✅ *Game Added Successfully!* 🎯\n\n*Title:* ${s.data.tipTitle}\n💰 *Price:* $${s.data.tipPrice}\n📈 *Odd:* ${s.data.oddRatio}`,
              {
                parse_mode: "Markdown",
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "⬅ Back to Admin Panel",
                        callback_data: "admin_panel",
                      },
                      {
                        text: "📢 Broadcast to Users",
                        callback_data: "broadcast_new_game",
                      },
                    ],
                  ],
                },
              }
            );
          } catch (err) {
            console.error("Add game error:", err.message || err);
            await bot.sendMessage(chatId, "⚠️ Error adding game.");
          }

          delete sessions[chatId];
          return;
      }
    }
  } catch (err) {
    console.error("message handler error:", err.message || err);
    await bot.sendMessage(chatId, "⚠️ Error processing your message.");
    delete sessions[chatId];
  }
});

// === startAddGameFlow helper (admin) ===
function startAddGameFlow(chatId) {
  sessions[chatId] = { flow: "add_game", step: 1, data: {} };
  bot.sendMessage(chatId, "🎮 Enter the Game Title:");
}
// === manage_tips & manage_users implementations (simplified) ===
const chatSessions = {};
async function handleManageTips(chatId, showAll = false) {
  try {
    const res = await apiGet("/api/games/allGame");
    let games = res.data || [];
    if (!games.length) {
      return bot.sendMessage(chatId, "⚠️ <b>No tips available.</b>", {
        parse_mode: "HTML",
      });
    }

    // Filter pending if showAll = false
    if (!showAll) {
      games = games.filter((g) => g.status === "Pending");
      if (!games.length) {
        return bot.sendMessage(chatId, "⚠️ <b>No pending tips.</b>", {
          parse_mode: "HTML",
        });
      }
    }

    let text = showAll
      ? "🧾 <b>All Tips:</b>\n\n"
      : "🧾 <b>Pending Tips:</b>\n\n";

    const keyboard = [];

    for (const g of games) {
      const tipTitle = escapeHTML(g.tipTitle);
      const price = escapeHTML(String(g.tipPrice));
      const purchasedCount = g.purchasedBy ? g.purchasedBy.length : 0;
      const duration = escapeHTML(String(g.duration));
      const status = g.active ? "🟢 Active" : "🔴 Inactive";

      text += `🏆 <b>${tipTitle}</b>\n`;
      text += `💵 $${price} | ${purchasedCount} <b>Purchased:</b>\n`;
      text += `🕕 <b>Duration:</b> ${duration} mins\n`;
      text += `📊 <b>Status:</b> ${status}\n`;
      text += `─────────────────\n`;

      keyboard.push([
        { text: `📊 View ${g.tipTitle}`, callback_data: `tip_${g._id}` },
      ]);
    }

    // Toggle button
    keyboard.push([
      {
        text: showAll ? "⬆️ Show Less" : "⬇️ Show All",
        callback_data: `toggle_tips`,
      },
    ]);

    // Back button
    keyboard.push([{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }]);

    // Save current state
    chatSessions[chatId] = { showAllTips: showAll };

    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    console.error("handleManageTips error:", err.message || err);
    await bot.sendMessage(chatId, "⚠️ Failed to fetch tips.", {
      parse_mode: "HTML",
    });
  }
}

// Handle toggle button callback
bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data === "toggle_tips") {
    const session = chatSessions[chatId] || { showAllTips: false };
    const newShowAll = !session.showAllTips;

    // Delete previous message and resend updated list
    await bot
      .deleteMessage(chatId, callbackQuery.message.message_id)
      .catch(() => {});
    await handleManageTips(chatId, newShowAll);
    await bot.answerCallbackQuery(callbackQuery.id);
  }
});

async function handleTipDetails(chatId, gameId) {
  try {
    const res = await apiGet(`/api/games/allGame`);
    const games = res.data || [];
    const selected = games.find((g) => String(g._id) === String(gameId));

    if (!selected) {
      console.warn(`Game not found for ID: ${gameId}`);
      return bot.sendMessage(chatId, "⚠️ Game not found.");
    }

    const buyerCount = selected.purchasedBy?.length || 0;
    const renderStars = (level) => {
      return "⭐".repeat(Number(level) || 0) || "N/A";
    };
    const details = `
🏆 *${escapeMarkdown(selected.tipTitle)}*

💵 *Price:* $${escapeMarkdown(selected.tipPrice)}
📈 *Odds:* ${escapeMarkdown(selected.oddRatio)}
🎯 *Confidence:* ${renderStars(selected.confidenceLevel) || "N/A"}⭐
🏦 *Betting Site:* ${escapeMarkdown(
      Array.isArray(selected.bettingSites)
        ? selected.bettingSites.join(", ")
        : selected.bettingSites || "N/A"
    )}

⏱ *Duration:* ${escapeMarkdown(selected.duration || "N/A")} mins
🎰 *Tip Status:* ${escapeMarkdown(selected.status || "⌛Pending")} 
📦 *Current Purchases:* ${escapeMarkdown(selected.CurrentLimit || 0)}
🧍‍♂️ *Total Buyers:* ${buyerCount}
🎯 *Purchase Limit:* ${escapeMarkdown(selected.purchaseLimit || "∞")}
⚙️ *Status:* ${selected.active ? "🟢 Active" : "🔴 Inactive"}

──────────────

📝 *Full Content:*
${escapeMarkdown(selected.contentAfterPurchase || "No description provided.")}
`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: selected.active ? "🔴 Deactivate" : "🟢 Activate",
            callback_data: `toggle_${selected._id}`,
          },
          {
            text: "📢 Notify Buyers",
            callback_data: `notify_${selected._id}`,
          },
        ],
        [
          {
            text: "⏰Extend time",
            callback_data: `updateTime_${selected._id}`,
          },
        ],
        [
          {
            text: "📊 Update Status",
            callback_data: `update_${selected._id}`,
          },
        ],
        [{ text: "⬅️ Back to Tips", callback_data: "manage_tips" }],
      ],
    };

    if (selected.image) {
      await bot.sendPhoto(chatId, selected.image, {
        caption: details,
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      });
    } else {
      await bot.sendMessage(chatId, details, {
        parse_mode: "Markdown",
        reply_markup: inlineKeyboard,
      });
    }
  } catch (err) {
    console.error("handleTipDetails error:", err.message || err);
    await bot.sendMessage(chatId, "⚠️ Error fetching tip details.");
  }
}
const userPagination = {};

async function handleManageUsers(chatId, page = 1, messageId = null) {
  try {
    // Cache users for current admin
    if (!userPagination[chatId] || !userPagination[chatId].users) {
      const res = await apiGet("/api/auth/getUsers");
      const users = res.data.users || [];
      if (!users.length) return bot.sendMessage(chatId, "No users found.");

      userPagination[chatId] = { users, page: 1 };
    }

    const { users } = userPagination[chatId];
    const totalPages = Math.ceil(users.length / 10);
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    userPagination[chatId].page = currentPage;

    const start = (currentPage - 1) * 10;
    const end = start + 10;
    const pageUsers = users.slice(start, end);

    // Create user buttons (10 per page)
    const userButtons = pageUsers.map((u) => [
      {
        text: `${u.userName || "Unknown"} (${u.email || "no email"})`,
        callback_data: `user_${u._id}`,
      },
    ]);

    // Pagination control buttons (3 in one row)
    const paginationRow = [
      {
        text: "⬅️ Prev",
        callback_data:
          currentPage > 1 ? `manage_users_page_${currentPage - 1}` : "noop",
      },
      {
        text: `📄 ${currentPage}/${totalPages}`,
        callback_data: "noop",
      },
      {
        text: "➡️ Next",
        callback_data:
          currentPage < totalPages
            ? `manage_users_page_${currentPage + 1}`
            : "noop",
      },
    ];

    const inlineKeyboard = [...userButtons, paginationRow];

    const summary = `👥 *Users:* ${users.length}\n📄 *Page:* ${currentPage}/${totalPages}`;

    // If editing an existing message, update it smoothly
    if (messageId) {
      await bot.editMessageText(summary, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    } else {
      await bot.sendMessage(chatId, summary, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: inlineKeyboard },
      });
    }
  } catch (err) {
    console.error("handleManageUsers error:", err.message || err);
    await bot.sendMessage(chatId, "⚠️ Failed to fetch users.");
  }
}

// Handle button clicks
bot.on("callback_query", async (query) => {
  const { data, message } = query;
  const chatId = message.chat.id;

  try {
    // Handle pagination buttons
    if (data.startsWith("manage_users_page_")) {
      const page = parseInt(data.split("_").pop());
      return handleManageUsers(chatId, page, message.message_id);
    }

    // Ignore 'noop' clicks
    if (data === "noop") {
      return bot.answerCallbackQuery(query.id, {
        text: "⏺️ This is current page",
      });
    }

    // Handle user selection
    if (data.startsWith("user_")) {
      const userId = data.split("_")[1];
      await bot.sendMessage(chatId, `ℹ️ Selected user ID: *${userId}*`, {
        parse_mode: "Markdown",
      });
      return;
    }
  } catch (err) {
    console.error("callback_query error:", err.message);
    if (!err.response?.description?.includes("query is too old")) {
      await bot.sendMessage(chatId, "⚠️ Error processing your request.");
    }
  }
});

// === user selector and actions ===
bot.on("callback_query", async (query) => {
  // Note: we already have a main callback_query listener. This duplicate ensures user actions (toggleUser, deleteUser) are handled.
  const data = query.data;
  const chatId = query.message.chat.id;
  try {
    if (data.startsWith("user_")) {
      const userId = data.split("_")[1];
      const res = await apiGet("/api/auth/getUsers");
      const user = (res.data.users || []).find(
        (u) => String(u._id) === String(userId)
      );
      if (!user) return bot.sendMessage(chatId, "User not found.");

      const status = user.active ? "🟢 Active" : "🔴 Blocked";
      const options = {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: user.active ? "🚫 Block" : "✅ Unblock",
                callback_data: `toggleUser_${userId}`,
              },
            ],
            [{ text: "🗑 Delete User", callback_data: `deleteUser_${userId}` }],
            [{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }],
          ],
        },
      };
      await bot.sendMessage(
        chatId,
        `👤 ${user.userName}\n📧 ${user.email}\nBalance: $${
          user.availableBalance || 0
        }\nStatus: ${status}`,
        options
      );
    }

    if (data.startsWith("toggleUser_")) {
      const userId = data.split("_")[1];
      const res = await apiGet("/api/auth/getUsers");
      const user = (res.data.users || []).find(
        (u) => String(u._id) === String(userId)
      );
      if (!user) return bot.sendMessage(chatId, "User not found.");
      if (user.active) {
        await apiPut(`/api/auth/deactivateUser/${userId}`);
        await bot.sendMessage(chatId, `🚫 ${user.userName} has been blocked.`);
      } else {
        await apiPut(`/api/auth/reactivateUser/${userId}`);
        await bot.sendMessage(
          chatId,
          `✅ ${user.userName} has been unblocked.`
        );
      }
    }

    if (data === "broadcast_new_game") {
      if (!global.lastAddedGame) {
        await bot.sendMessage(chatId, "⚠️ No new game found to broadcast.");
        return;
      }

      const game = global.lastAddedGame;
      const renderStars = (level) => {
        return "⭐".repeat(Number(level) || 0) || "N/A";
      };
      // 🔥 Safe message for MarkdownV2
      const message = `🎯 *New Game Alert\\!* 🎯
──────────────
🏆 *Title:* ${escapeMarkdownV2(game.tipTitle)}
💰 *Price:* \\$${escapeMarkdownV2(String(game.tipPrice))}
📊 *Odd:* ${escapeMarkdownV2(String(game.oddRatio))}
🔥 *Confidence:* ${renderStars(game.confidenceLevel) || "N/A"}
──────────────
🧠 *Summary:* ${escapeMarkdownV2(
        game.shortDescription || "New tip available now!"
      )}
──────────────
👉 *Check it now in the /tips section\\!*`;

      await bot.sendMessage(chatId, "📢 Broadcasting new game to all users...");

      let successCount = 0;
      let failCount = 0;

      for (const [userChatId, ctx] of userContext.entries()) {
        if (String(userChatId) === String(chatId)) continue;

        try {
          await bot.sendMessage(userChatId, message, {
            parse_mode: "MarkdownV2",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎯 View Tips Now", callback_data: "tips" }],
              ],
            },
          });
          successCount++;
        } catch (err) {
          console.error(`Failed to broadcast to ${userChatId}:`, err.message);
          failCount++;
        }
      }

      await bot.sendMessage(
        chatId,
        `✅ Broadcast complete\\!\n\n📨 Sent: ${successCount}\n⚠️ Failed: ${failCount}`,
        { parse_mode: "MarkdownV2" }
      );

      await bot.answerCallbackQuery(query.id);
    }

    if (data.startsWith("deleteUser_")) {
      const userId = data.split("_")[1];
      await apiDelete(`/api/auth/deleteUser/${userId}`);
      await bot.sendMessage(chatId, "🗑 User deleted successfully.");
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("user action error:", err.message || err);
  }
});

// === Graceful shutdown ===
process.on("SIGINT", () => {
  console.log("Shutting down...");
  process.exit();
});
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  process.exit();
});

module.exports = bot;
