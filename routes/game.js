const express = require("express");
const Game = require("../models/Game");
const router = express.Router();

// Get all games
router.get("/allGame", async (req, res) => {
  try {
    const games = await Game.find();
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: "Error fetching games" });
  }
});

// Admin route to add a new game
router.post("/add", async (req, res) => {
  const {
    tipTitle,
    bettingType,
    tipPrice,
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
      bettingSites,
      confidenceLevel,
      contentAfterPurchase,
      duration,
      purchaseLimit,
    });

    await newGame.save();
    res.status(201).json({ message: "Game added successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error adding game" });
  }
});

// Admin route to delete a game by ID
// Admin route to delete a game by ID
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const game = await Game.findByIdAndDelete(id);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }
    res.status(200).json({ message: "Game deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting game" });
  }
});

// Admin route to edit a game's details, including active status
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const {
    tipTitle,
    tipPrice,
    bettingType,
    oddRatio,
    bettingSites,
    confidenceLevel,
    contentAfterPurchase,
    duration,
    purchaseLimit,
    active, // Assuming 'active' is a boolean that determines whether the game is active or not
  } = req.body;

  try {
    const updatedGame = await Game.findByIdAndUpdate(
      id,
      {
        tipTitle,
        tipPrice,
        oddRatio,
        bettingType,
        bettingSites,
        confidenceLevel,
        contentAfterPurchase,
        duration,
        purchaseLimit,
        active, // updating active status
      },
      { new: true } // returns the updated document
    );

    if (!updatedGame) {
      return res.status(404).json({ message: "Game not found" });
    }

    res
      .status(200)
      .json({ message: "Game updated successfully", game: updatedGame });
  } catch (error) {
    res.status(500).json({ message: "Error updating game" });
  }
});
router.put("/:id/toggle-active", async (req, res) => {
  const { id } = req.params;

  try {
    // Find the game by ID and toggle its 'active' status
    const game = await Game.findById(id);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    // Toggle the active status
    game.active = !game.active;

    await game.save(); // Save the updated game with the new active status
    res.status(200).json({
      message: `Game is now ${game.active ? "active" : "inactive"}`,
      game,
    });
  } catch (error) {
    res.status(500).json({ message: "Error toggling game status" });
  }
});
router.put("/:id/increment-current-limit", async (req, res) => {
  const { id } = req.params;

  try {
    // Find the game by ID
    const game = await Game.findById(id);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    // Increment the CurrentLimit value by 1
    game.CurrentLimit += 1;

    await game.save(); // Save the updated game with the incremented CurrentLimit

    res.status(200).json({
      message: `CurrentLimit incremented to ${game.CurrentLimit}`,
      game,
    });
  } catch (error) {
    res.status(500).json({ message: "Error incrementing CurrentLimit" });
  }
});

module.exports = router;
