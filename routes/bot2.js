const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const BACKEND_URL = process.env.SERVER;
const ADMIN_ID = Number(process.env.TELEGRAM_CHAT_ID);
const sessions = {};

//
// 📍 ADMIN PANEL
//
const userContext = new Map();
const sendMainMenu = async (chatId, userId, userName) => {
  try {
    // Fetch user data from backend
    const res = await axios.get(
      `${process.env.SERVER}/api/auth/getUserById/${userId}`
    );
    const user = res.data.user;

    const balance = user?.availableBalance?.toFixed(2) || "0.00";
    const role = user?.role || "customer";

    const adminCaption = `
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
        { text: "📣 Update Channel", callback_data: "update_channel" },
      ],
    ];

    if (role === "admin") {
      buttons.push([{ text: "👤 Admin Panel", callback_data: "admin_panel" }]);
    }

    const keyboard = {
      reply_markup: { inline_keyboard: buttons },
      parse_mode: "Markdown",
    };

    await bot.sendPhoto(
      chatId,
      "https://raw.githubusercontent.com/Favour-111/my-asset/main/image.jpg",
      {
        caption: adminCaption,
        ...keyboard,
      }
    );
  } catch (err) {
    console.error("Error sending main menu:", err.message);
    await bot.sendMessage(chatId, "❌ Failed to load menu.");
  }
};

async function getAdminStats() {
  try {
    const res = await axios.get(`${process.env.SERVER}/api/games/stats`);
    if (res.data.success) return res.data;

    return { users: 0, tips: 0, activeTips: 0, purchases: 0, revenue: 0 };
  } catch (err) {
    console.error("⚠️ getAdminStats error:", err.message);
    return { users: 0, tips: 0, activeTips: 0, purchases: 0, revenue: 0 };
  }
}

bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (userId !== Number(ADMIN_ID)) {
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
        [{ text: "⬅️ Back to Main Menu", callback_data: "back_main" }],
      ],
    },
    parse_mode: "Markdown",
  };

  bot.sendMessage(chatId, adminText, keyboard);
});
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name || "User";
  const email = `${msg.from.username || "unknown"}@Dummy.com`;

  try {
    const signupRes = await axios.post(
      `${process.env.SERVER}/api/auth/telegram-signup`,
      {
        telegramId: msg.from.id,
        userName,
        email,
      }
    );

    const user = signupRes.data.user;
    const userId = user._id;
    const balance = user.availableBalance || 0;

    // Save in context map
    userContext.set(chatId, { userId, balance });

    console.log(`✅ Stored context for chatId ${chatId}: ${userId}`);
  } catch (err) {
    console.error("❌ Error syncing Telegram user:", err.message);
  }
});

//
// 🧩 CALLBACK HANDLERS
//
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  // Only admin allowed
  if (query.from.id !== ADMIN_ID) {
    bot.answerCallbackQuery(query.id, { text: "Unauthorized" });
    return;
  }

  switch (data) {
    //
    // ADD TIP (your existing flow)
    //
    case "add_tip":
      bot.sendMessage(chatId, "🎮 Let's add a new tip!");
      startAddGameFlow(chatId);
      break;

    //
    // ADD BALANCE
    //
    case "add_balance":
      bot.sendMessage(chatId, "👥 Fetching users...");
      try {
        const { data } = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
        const users = data.users || [];
        if (!users.length) return bot.sendMessage(chatId, "No users found.");

        const buttons = users.slice(0, 30).map((u) => [
          {
            text: `${u.userName} (${u.email})`,
            callback_data: `select_user_${u._id}`,
          },
        ]);

        bot.sendMessage(chatId, "Select a user to add balance:", {
          reply_markup: { inline_keyboard: buttons },
        });
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Error fetching users.");
      }
      break;

    //
    //statistics
    //
    case "view_stats":
      try {
        const [gameStatsRes, userRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/api/games/stats`),
          axios.get(`${BACKEND_URL}/api/auth/getUsers`),
        ]);

        const stats = gameStatsRes.data || {};
        const users = userRes.data.users || [];

        // === USERS ===
        const totalUsers = users.length;
        const activeUsers = users.filter((u) => u.active).length;
        const blockedUsers = totalUsers - activeUsers;

        // === TIPS ===
        const totalTips = stats.tips || 0;
        const activeTips = stats.activeTips || 0;
        const urgentTips = stats.urgentTips || 0; // optional, add if you track urgency

        // === REVENUE ===
        const totalRevenue = stats.revenue || 0;

        // Total purchases (sum of all users’ betHistory lengths)
        const totalPurchases = users.reduce(
          (sum, u) => sum + (u.betHistory?.length || 0),
          0
        );

        // === BALANCES ===
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

        const keyboard = {
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }],
            ],
          },
          parse_mode: "Markdown",
        };

        await bot.sendMessage(chatId, statsText, keyboard);
      } catch (err) {
        console.error("⚠️ Error fetching statistics:", err.message);
        bot.sendMessage(chatId, "⚠️ Failed to fetch detailed statistics.");
      }
      break;

    //
    // MANAGE TIPS
    //

    case "manage_tips":
      try {
        const { data } = await axios.get(`${BACKEND_URL}/api/games/allGame`);
        const games = data || [];
        if (!games.length)
          return bot.sendMessage(chatId, "⚠️ No active tips available.");

        let text = "🧾 *Active Tips:*\n\n";

        const keyboard = [];

        games.forEach((g, i) => {
          text += `*${i + 1}. ${g.tipTitle}*\n💵 ₦${g.tipPrice}\n🎯 ${
            g.confidenceLevel || "N/A"
          }⭐ | ${g.bettingSites || "Unknown"}\n📈 Odds: ${
            g.oddRatio
          }\nStatus: ${g.active ? "🟢 Active" : "🔴 Inactive"}\n\n`;
          text += "⚽️━━━━━━━━━━━━━━━⚽️\n\n";
          keyboard.push([
            { text: `📊 Manage ${g.tipTitle}`, callback_data: `tip_${g._id}` },
          ]);
        });

        games.push([
          { text: "⬅️ Back to Admin", callback_data: "admin_panel" },
        ]);
        bot.sendMessage(chatId, text, {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Failed to fetch tips.");
      }
      break;

    //

    // MANAGE USERS
    //
    case "manage_users":
      try {
        const { data } = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
        const users = data.users || [];

        if (!users.length) {
          return bot.sendMessage(chatId, "No users found yet.");
        }

        // === Calculate statistics ===
        const totalUsers = users.length;
        const activeUsers = users.filter((u) => u.active).length;
        const blockedUsers = totalUsers - activeUsers;
        const totalBalance = users.reduce(
          (sum, u) => sum + (u.availableBalance || 0),
          0
        );
        const avgBalance = (totalBalance / totalUsers).toFixed(2);

        // === Summary Header ===
        const summaryText = `
📊 *User Summary Overview*

👥 *Total Users:* ${totalUsers}
🟢 *Active Users:* ${activeUsers}
🔴 *Blocked Users:* ${blockedUsers}

💰 *Total System Balance:* $${totalBalance.toLocaleString()}
📈 *Average Balance/User:* $${avgBalance.toLocaleString()}
`;

        // === User buttons ===
        const userButtons = users.map((u) => [
          {
            text: `${u.userName} (${u.email})`,
            callback_data: `user_${u._id}`,
          },
        ]);

        // Add back button
        userButtons.push([
          { text: "⬅️ Back to Admin", callback_data: "admin_panel" },
        ]);

        // === Send summary first ===
        await bot.sendMessage(chatId, summaryText, { parse_mode: "Markdown" });

        // === Then send user list ===
        await bot.sendMessage(chatId, "👥 Select a user to manage:", {
          reply_markup: { inline_keyboard: userButtons },
        });
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Error loading users.");
      }
      break;

    //
    // BROADCAST
    //
    case "broadcast":
      bot.sendMessage(chatId, "📢 Enter the message to broadcast:");
      sessions[chatId] = { step: "broadcast" };
      break;

    //
    // MAIN MENU
    //
    case "main_menu":
      bot.sendMessage(
        chatId,
        "🏠 Back to main menu. Use /admin to reopen panel."
      );
      break;

    //
    // USER SELECTED FOR BALANCE
    //
    default:
      if (data.startsWith("select_user_")) {
        const userId = data.replace("select_user_", "");
        sessions[chatId] = { step: "add_balance", userId };
        bot.sendMessage(chatId, "💰 Enter amount to add to this user:");
      }
  }

  bot.answerCallbackQuery(query.id);

  if (data.startsWith("tip_")) {
    const gameId = data.split("_")[1];
    try {
      const { data: game } = await axios.get(
        `${BACKEND_URL}/api/games/allGame`
      );
      const selectedGame = game.find((g) => g._id === gameId);
      if (!selectedGame) return bot.sendMessage(chatId, "⚠️ Game not found.");

      // ✅ Safely escape MarkdownV2 special characters
      const escapeMarkdown = (text) => {
        if (text === null || text === undefined) return "";
        const str = String(text);
        return str.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
      };

      // 🧾 Build message body with spacing
      const details = `
🏆 *${escapeMarkdown(selectedGame.tipTitle)}*

💵 *Price:* ₦${escapeMarkdown(selectedGame.tipPrice)}
📈 *Odds:* ${escapeMarkdown(selectedGame.oddRatio)}
🎯 *Confidence:* ${escapeMarkdown(selectedGame.confidenceLevel || "N/A")}⭐
🏦 *Betting Site:* ${escapeMarkdown(selectedGame.bettingSites || "N/A")}
📅 *Duration:* ${escapeMarkdown(selectedGame.duration || "N/A")} Minutes
🛒 *Purchases:* ${escapeMarkdown(selectedGame.purchasedBy?.length || 0)}
⚙️ *Status:* ${selectedGame.active ? "🟢 Active" : "🔴 Inactive"}

──────────────────────────────

📝 *Full Content:*
${escapeMarkdown(
  selectedGame.contentAfterPurchase || "No description provided."
)}
`;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: selectedGame.active ? "🔴 Deactivate" : "🟢 Activate",
              callback_data: `toggle_${selectedGame._id}`,
            },
            {
              text: "📢 Notify Buyers",
              callback_data: `notify_${selectedGame._id}`,
            },
          ],
          [{ text: "⬅️ Back to Tips", callback_data: "manage_tips" }],
        ],
      };

      // 🖼️ Send image if available
      if (selectedGame.image) {
        await bot.sendPhoto(chatId, selectedGame.image, {
          caption: details,
          parse_mode: "MarkdownV2",
          reply_markup: inlineKeyboard,
        });
      } else {
        // fallback if no image
        await bot.sendMessage(chatId, details, {
          parse_mode: "MarkdownV2",
          reply_markup: inlineKeyboard,
        });
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Error fetching tip details.");
    }
  }

  // === Toggle Active Status ===
  if (data.startsWith("toggle_")) {
    const gameId = data.split("_")[1];
    try {
      const res = await axios.put(
        `${BACKEND_URL}/api/games/${gameId}/toggle-active`
      );
      bot.sendMessage(
        chatId,
        `✅ Tip "${res.data.game.tipTitle}" is now ${
          res.data.game.active ? "🟢 Active" : "🔴 Inactive"
        }`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Failed to toggle tip status.");
    }
  }

  // === Extend Duration ===
  if (data.startsWith("extend_")) {
    const gameId = data.split("_")[1];
    try {
      const res = await axios.put(
        `${BACKEND_URL}/api/games/${gameId}/increment-current-limit`
      );
      bot.sendMessage(
        chatId,
        `⏰ Tip duration extended. Current limit: ${res.data.game.CurrentLimit}`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Failed to extend tip duration.");
    }
  }

  // === Notify Buyers (send message to all who purchased) ===
  if (data.startsWith("notify_")) {
    const gameId = data.split("_")[1];
    try {
      const { data: allGames } = await axios.get(
        `${BACKEND_URL}/api/games/allGame`
      );
      const game = allGames.find((g) => g._id === gameId);
      if (!game) return bot.sendMessage(chatId, "Game not found.");

      if (!game.purchasedBy?.length)
        return bot.sendMessage(chatId, "⚠️ No buyers yet.");

      for (const userId of game.purchasedBy) {
        try {
          await bot.sendMessage(
            userId,
            `📢 *Update on your purchased game:*\n\n🏆 ${game.tipTitle}\n\nStay tuned for more updates!`,
            { parse_mode: "Markdown" }
          );
        } catch (err) {
          console.error(`Failed to notify ${userId}`);
        }
      }

      bot.sendMessage(
        chatId,
        `✅ Notification sent to all ${game.purchasedBy.length} buyers.`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Failed to notify buyers.");
    }
  }

  // Back navigation
  if (data === "manage_tips") {
    bot.emit("text", { chat: { id: chatId }, text: "/admin" });
  }

  bot.answerCallbackQuery(query.id);

  // === Show user management options ===
  if (data.startsWith("user_")) {
    const userId = data.split("_")[1];
    const { data: res } = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
    const user = res.users.find((u) => u._id === userId);

    if (!user) {
      return bot.sendMessage(chatId, "❌ User not found.");
    }

    const status = user.active ? "🟢 Active" : "🔴 Blocked";
    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: user.active ? "🚫 Block User" : "✅ Unblock User",
              callback_data: `toggleUser_${userId}`,
            },
          ],
          [{ text: "🗑 Delete User", callback_data: `deleteUser_${userId}` }],
          [{ text: "⬅️ Back to Admin", callback_data: "admin_panel" }],
        ],
      },
      parse_mode: "Markdown",
    };

    bot.sendMessage(
      chatId,
      `👤 *${user.userName}*\n📧 ${user.email}\n💰 Balance: $${
        user.availableBalance || 0
      }\nStatus: ${status}`,
      options
    );
  }

  // === Toggle (Block / Unblock) User ===
  if (data.startsWith("toggleUser_")) {
    const userId = data.split("_")[1];
    try {
      // Get user info to know current status
      const { data: res } = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
      const user = res.users.find((u) => u._id === userId);

      if (!user) return bot.sendMessage(chatId, "❌ User not found.");

      if (user.active) {
        await axios.put(`${BACKEND_URL}/api/auth/deactivateUser/${userId}`);
        bot.sendMessage(chatId, `🚫 *${user.userName}* has been blocked.`, {
          parse_mode: "Markdown",
        });
      } else {
        await axios.put(`${BACKEND_URL}/api/auth/reactivateUser/${userId}`);
        bot.sendMessage(chatId, `✅ *${user.userName}* has been unblocked.`, {
          parse_mode: "Markdown",
        });
      }
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "⚠️ Error updating user status.");
    }
  }

  // === Delete User ===
  if (data.startsWith("deleteUser_")) {
    const userId = data.split("_")[1];
    try {
      await axios.delete(`${BACKEND_URL}/api/auth/deleteUser/${userId}`);
      bot.sendMessage(chatId, "🗑 User deleted successfully.");
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "⚠️ Error deleting user.");
    }
  }

  // === Back to Admin Menu ===
  // === Back to Admin Panel ===
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
  // Show balance
  if (data.startsWith("balance_")) {
    const userId = data.split("_")[1];

    try {
      const res = await axios.get(
        `${process.env.SERVER}/api/auth/getUserById/${userId}`
      );
      const user = res.data.user;
      const balance = user?.availableBalance?.toFixed(2) || "0.00";

      const balanceKeyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Add Funds", callback_data: `deposit_${userId}` }],
            [{ text: "⬅ Back", callback_data: `back_${userId}` }],
          ],
        },
        parse_mode: "Markdown",
      };

      await bot.sendMessage(
        chatId,
        `💰 Your Balance: $${balance}`,
        balanceKeyboard
      );
    } catch (err) {
      console.error("Error fetching balance:", err.message);
      await bot.sendMessage(chatId, "❌ Failed to fetch balance.");
    }
  }

  // Back button
  if (data.startsWith("back_")) {
    const userId = data.split("_")[1];
    await sendMainMenu(chatId, userId);
  }

  // Handle "Available Tips" (example)
  if (data === "tips") {
    try {
      // Fetch all active games
      const response = await axios.get(
        `${process.env.SERVER}/api/games/allGame`
      );
      const games = response.data.filter((game) => game.active);

      if (!games.length) {
        return await bot.sendMessage(
          chatId,
          "⚠ No active tips available at the moment.",

          "⌛ Wait for new tips from our experts."
        );
      }

      // Build message text
      // Function to convert number to stars
      const renderStars = (level) => {
        const maxStars = 5;
        const filledStars = "⭐".repeat(level || 0);
        return filledStars;
      };

      let tipsMessage = "";

      games.forEach((game, index) => {
        tipsMessage += `
🏆 Title: ${game.tipTitle}
💰 Price: $${game.tipPrice.toFixed(2)}
📊 Odds ratio: ${game.oddRatio || "N/A"}
🎯 Confidence level: ${renderStars(game.confidenceLevel)}
⏰ Availability: ${game.duration || "N/A"} minutes
📦 Purchase limit: ${game.purchaseLimit || "No limit"}
------------------------
`;
      });

      // Build inline keyboard for each tip
      const buttons = games.map((game) => [
        {
          text: `Buy ${game.tipTitle} - $${game.tipPrice}`,
          callback_data: `buy_${game._id}`, // will handle in callback
        },
      ]);

      // Add a back button
      // buttons.push([{ text: "🔙 Back", callback_data: "back_to_main" }]);

      await bot.sendMessage(chatId, tipsMessage, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (err) {
      console.error("Error fetching tips:", err.message);
      await bot.sendMessage(chatId, "❌ Failed to fetch tips.");
    }
  }
  // 🔹 Handle tip purchase
  if (data.startsWith("buy_")) {
    const gameId = data.split("_")[1];
    const user = userContext.get(chatId);
    const userId = user.userId;

    try {
      const buyRes = await axios.put(
        `${process.env.SERVER}/api/games/${gameId}/buy`,
        { userId }
      );

      const game = buyRes.data.game;

      // Increment limit
      await axios.put(
        `${process.env.SERVER}/api/games/${gameId}/increment-current-limit`
      );

      // Deduct balance
      await axios.post(`${process.env.SERVER}/api/games/updateBalance`, {
        userId,
        amount: game.tipPrice,
      });

      // Add to bet history
      await axios.put(
        `${process.env.SERVER}/api/games/addBetHistory/${userId}`,
        {
          gameContent: game.gameContent,
          gameName: game.gameName,
          gameDate: game.gameDate,
          gameId: game._id,
          tipOdd: game.tipOdd,
          image: game.image,
          tipName: game.tipName,
          tipPrice: game.tipPrice,
          status: "Pending",
        }
      );

      // Update context balance
      userContext.set(chatId, {
        ...user,
        balance: user.balance - game.tipPrice,
      });

      // Send success message
      const tipMessage = `
✅ *Purchase Successful!*

🎯 Tip: *${game.tipName}*
🎮 Game: *${game.gameName}*
💵 Price: $${game.tipPrice}
📅 Date: ${new Date(game.gameDate).toLocaleString()}
💰 Your remaining balance: $${(user.balance - game.tipPrice).toFixed(2)}
    `;

      const tipButtons = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Add Funds", callback_data: "deposit" }],
            [{ text: "🔙 Back to Tips", callback_data: "tips" }],
          ],
        },
        parse_mode: "Markdown",
      };

      await bot.sendMessage(chatId, tipMessage, tipButtons);
    } catch (err) {
      console.error("Error purchasing tip:", err.message);
      await bot.sendMessage(
        chatId,
        "❌ Failed to purchase tip. Please try again."
      );
    }
  }

  // 🔹 Handle back to main menu
  if (data === "back_") {
    bot.emit("text", { chat: { id: chatId }, text: "/start" });
  }

  // Handle Add Funds
  if (data.startsWith("deposit_")) {
    const userId = data.split("_")[1];
    await bot.sendMessage(
      chatId,
      "💳 Send funds to your account via the website link or payment gateway."
    );
  }

  // Handle Back
  if (data.startsWith("back_")) {
    const userId = data.split("_")[1];
    // Call the start function or resend the main menu
    bot.emit("text", { chat: { id: chatId }, text: "/start" });
  }

  bot.answerCallbackQuery(query.id);
});

//
// 📨 MESSAGE HANDLER (for broadcast, balance, addgame inputs)
//
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const session = sessions[chatId];

  if (!session || text.startsWith("/")) return;

  // Broadcast
  if (session.step === "broadcast") {
    bot.sendMessage(chatId, "📤 Broadcasting message...");
    try {
      const { data } = await axios.get(`${BACKEND_URL}/api/auth/getUsers`);
      const users = data.users || [];
      for (const user of users) {
        await bot
          .sendMessage(user.telegramId || ADMIN_ID, text)
          .catch(() => {});
      }
      bot.sendMessage(chatId, "✅ Broadcast complete!");
    } catch {
      bot.sendMessage(chatId, "⚠️ Failed to broadcast.");
    }
    delete sessions[chatId];
    return;
  }

  // Add Balance
  if (session.step === "add_balance") {
    const amount = parseFloat(text);
    if (isNaN(amount)) return bot.sendMessage(chatId, "❌ Invalid amount.");

    try {
      await axios.post(`${BACKEND_URL}/api/auth/deposit`, {
        userId: session.userId,
        amount,
      });
      bot.sendMessage(chatId, `✅ Added ₦${amount} successfully!`);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "⚠️ Failed to add balance.");
    }
    delete sessions[chatId];
    return;
  }
});

//
// 🎮 ADD GAME FLOW
//
function startAddGameFlow(chatId) {
  sessions[chatId] = { step: 1, data: {} };
  bot.sendMessage(chatId, "🎮 Enter the *Game Title*:", {
    parse_mode: "Markdown",
  });
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const session = sessions[chatId];

  if (
    !session ||
    session.step === "add_balance" ||
    session.step === "broadcast"
  )
    return;

  switch (session.step) {
    case 1:
      session.data.tipTitle = text;
      session.step++;
      return bot.sendMessage(chatId, "💰 Enter the *Price*:");
    case 2:
      session.data.tipPrice = Number(text);
      session.step++;
      return bot.sendMessage(chatId, "📈 Enter the *Odd Ratio*:");
    case 3:
      session.data.oddRatio = Number(text);
      session.step++;
      return bot.sendMessage(chatId, "🖼️ Enter *Image URL*:");
    case 4:
      session.data.image = text;
      session.step++;
      return bot.sendMessage(chatId, "🔥 Enter *Confidence Level* (1–5):");
    case 5:
      session.data.confidenceLevel = text;
      session.step++;
      return bot.sendMessage(chatId, "⏱️ Enter *Duration (mins)*:");
    case 6:
      session.data.duration = Number(text);
      session.step++;
      return bot.sendMessage(
        chatId,
        "🏦 Enter *Betting Sites* (comma separated):"
      );
    case 7:
      session.data.bettingSites = text.split(",").map((s) => s.trim());
      session.step++;
      return bot.sendMessage(chatId, "📝 Enter *Content After Purchase*:");
    case 8:
      session.data.contentAfterPurchase = text;
      session.data.purchaseLimit = 100;
      try {
        await axios.post(`${BACKEND_URL}/api/games/add`, session.data);
        bot.sendMessage(
          chatId,
          `✅ Game added!\n\n*Title:* ${session.data.tipTitle}\n*Price:* ₦${session.data.tipPrice}\n*Odd:* ${session.data.oddRatio}`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Error adding game.");
      }
      delete sessions[chatId];
      break;
  }
});
