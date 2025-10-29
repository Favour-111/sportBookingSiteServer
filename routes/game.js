const express = require("express");
const Game = require("../models/Game");
const User = require("../models/User");
const router = express.Router();
const axios = require("axios");
const { sendSafeTelegramMessage } = require("../utils/telegramHelper");
// Get all games
router.get("/allGame", async (req, res) => {
  try {
    const games = await Game.find();
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: "Error fetching games" });
  }
});

// Get admin statistics
router.get("/stats", async (req, res) => {
  try {
    const users = await User.countDocuments();
    const games = await Game.countDocuments();
    const activeTips = await Game.countDocuments({ active: true });

    // Fetch all users and include only betHistory
    const allUsers = await User.find({}, "betHistory");

    // Sum up all tipPrice values inside each user's betHistory
    let totalRevenue = 0;
    allUsers.forEach((user) => {
      if (Array.isArray(user.betHistory)) {
        totalRevenue += user.betHistory.reduce(
          (sum, bet) => sum + (bet.tipPrice || 0),
          0
        );
      }
    });

    res.json({
      success: true,
      users,
      tips: games,
      activeTips,
      revenue: totalRevenue,
    });
  } catch (err) {
    console.error("⚠️ Error generating game stats:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate statistics",
    });
  }
});

// Admin route to add a new game

router.post("/add", async (req, res) => {
  const {
    tipTitle,
    bettingType,
    tipPrice,
    image,
    oddRatio,
    bettingSites,
    confidenceLevel,
    contentAfterPurchase,
    duration,
    purchaseLimit,
  } = req.body;

  try {
    const newGame = new Game({
      tipTitle,
      tipPrice,
      bettingType,
      oddRatio,
      image,
      bettingSites,
      confidenceLevel,
      contentAfterPurchase,
      duration,
      purchaseLimit,
    });

    await newGame.save();

    // ✅ Emit event to all connected clients
    const io = req.app.get("io");
    io.emit("gameAdded", newGame);

    res.status(201).json({ message: "Game added successfully", newGame });
  } catch (error) {
    res.status(500).json({ message: "Error adding game" });
  }
});

// ---------------- DELETE GAME ----------------
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const game = await Game.findByIdAndDelete(id);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    // ✅ Notify clients
    const io = req.app.get("io");
    io.emit("gameDeleted", { id });

    res.status(200).json({ message: "Game deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting game" });
  }
});

// ---------------- EDIT GAME ----------------
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    const updatedGame = await Game.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    if (!updatedGame) {
      return res.status(404).json({ message: "Game not found" });
    }

    // ✅ Notify all clients
    const io = req.app.get("io");
    io.emit("gameUpdated", updatedGame);

    res
      .status(200)
      .json({ message: "Game updated successfully", game: updatedGame });
  } catch (error) {
    res.status(500).json({ message: "Error updating game" });
  }
});

// ---------------- TOGGLE ACTIVE ----------------
router.put("/:id/toggle-active", async (req, res) => {
  const { id } = req.params;

  try {
    const game = await Game.findById(id);
    if (!game) return res.status(404).json({ message: "Game not found" });

    game.active = !game.active;
    await game.save();

    const io = req.app.get("io");
    io.emit("gameToggled", game);

    res.status(200).json({
      message: `Game is now ${game.active ? "active" : "inactive"}`,
      game,
    });
  } catch (error) {
    res.status(500).json({ message: "Error toggling game status" });
  }
});

// ---------------- BUY GAME ----------------
router.put("/:id/buy", async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  try {
    const game = await Game.findById(id);
    if (!game) return res.status(404).json({ message: "Game not found" });
    if (!userId) return res.status(400).json({ message: "UserId is required" });
    if (game.purchasedBy.includes(userId)) {
      return res.status(400).json({ message: "Already purchased" });
    }

    // Save the purchase
    game.purchasedBy.push(userId);
    await game.save();

    // Emit to socket.io clients
    const io = req.app.get("io");
    io.emit("gamePurchased", { gameId: id, userId });

    // ✅ Telegram Notification
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const user = await User.findById(userId);

    const message = `
🎮 *New Game Purchase!*

👤 *User:* ${user.userName} (${user.email})
🆔 *User ID:* ${user._id}

🕹 *Game:* ${game.tipTitle}
💵 *Price:* $${game.tipPrice}

📅 *Date:* ${new Date().toLocaleString()}
`;

    await sendSafeTelegramMessage(CHAT_ID, message, TELEGRAM_BOT_TOKEN);

    res.status(200).json({ message: "Game purchased successfully", game });
  } catch (error) {
    console.error("Error processing purchase:", error);
    res.status(500).json({ message: "Error processing purchase" });
  }
});

// ---------------- UPDATE GAME STATUS ----------------
router.put("/updategameStatus/:gameId", async (req, res) => {
  const { gameId } = req.params;
  const { gameStatus } = req.body;

  try {
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    // ✅ Check duration logic
    if (game.active) {
      return res.status(400).json({
        message: "Game is still active. Deactivate it before updating status.",
      });
    }

    // ✅ Calculate if duration elapsed
    const createdAt = game.createdAt || game._id.getTimestamp();
    const elapsedMs = Date.now() - new Date(createdAt).getTime();
    const durationMs = (game.duration || 0) * 60 * 1000;

    if (elapsedMs < durationMs) {
      const remaining = Math.ceil((durationMs - elapsedMs) / 60000);
      return res.status(400).json({
        message: `Game duration not yet elapsed. Try again in ${remaining} min${
          remaining !== 1 ? "s" : ""
        }.`,
      });
    }

    // ✅ Proceed to update
    const updatedGame = await Game.findByIdAndUpdate(
      gameId,
      { status: gameStatus },
      { new: true }
    );

    await User.updateMany(
      { "betHistory.gameId": gameId },
      { $set: { "betHistory.$[elem].status": gameStatus } },
      { arrayFilters: [{ "elem.gameId": gameId }] }
    );

    const io = req.app.get("io");
    io.emit("gameStatusUpdated", { gameId, gameStatus });

    res.status(200).json({
      message: "Game status updated successfully",
      gameId,
      gameStatus,
    });
  } catch (error) {
    console.error("Error updating game status:", error);
    res.status(500).json({ message: "Error updating game status" });
  }
});

// ---------------- INCREMENT CURRENT LIMIT ----------------
router.put("/:id/increment-current-limit", async (req, res) => {
  const { id } = req.params;

  try {
    const game = await Game.findById(id);
    if (!game) return res.status(404).json({ message: "Game not found" });

    game.CurrentLimit += 1;
    await game.save();

    const io = req.app.get("io");
    io.emit("limitIncremented", { id, CurrentLimit: game.CurrentLimit });

    res.status(200).json({
      message: `CurrentLimit incremented to ${game.CurrentLimit}`,
      game,
    });
  } catch (error) {
    res.status(500).json({ message: "Error incrementing CurrentLimit" });
  }
});

module.exports = router;
