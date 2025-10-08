const express = require("express");
const Game = require("../models/Game");
const router = express.Router();

// Get all games
router.get("/", async (req, res) => {
  try {
    const games = await Game.find();
    res.json(games);
  } catch (error) {
    res.status(500).json({ message: "Error fetching games" });
  }
});

// Admin route to add a new game
router.post("/add", async (req, res) => {
  const { name, description, price } = req.body;
  try {
    const newGame = new Game({ name, description, price });
    await newGame.save();
    res.status(201).json({ message: "Game added successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error adding game" });
  }
});

module.exports = router;
