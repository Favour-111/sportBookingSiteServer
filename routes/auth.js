const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();

router.get("/", async (req, res) => {
  res.send({
    msg: "connectted",
  });
});
router.post("/signup", async (req, res) => {
  const { userName, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists ,Login" });

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ email, password: hashedPassword, userName });
    await newUser.save();
    res.status(201).json({ message: "User created successfully", newUser });
  } catch (error) {
    res.status(500).json({ message: "Error creating user" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid Password" });

    const token = jwt.sign({ userId: user._id }, "secretKey", {
      expiresIn: "1h",
    });
    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ message: "Error logging in" });
  }
});

router.post("/deposit", async (req, res) => {
  const { userId, amount } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ message: "User not found" });

    // Update available balance
    user.availableBalance += parseFloat(amount);
    await user.save();

    res.status(200).json({
      message: "Deposit successful",
      availableBalance: user.availableBalance,
    });
  } catch (error) {
    console.error("Error processing deposit:", error);
    res.status(500).json({ message: "Error processing deposit" });
  }
});
router.get("/getUsers", async (req, res) => {
  const users = await User.find();
  if (users) {
    res.send({
      users,
    });
  } else {
    res.send({
      success: "false",
      msg: "error fetching users",
    });
  }
});
router.delete("/deleteUser/:id", async (req, res) => {
  const { id } = req.params; // Get the user ID from the route parameter

  try {
    // Find and delete the user by ID
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "User deleted successfully", deletedUser });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Error deleting user" });
  }
});

// Add Telegram login route here if needed

module.exports = router;
