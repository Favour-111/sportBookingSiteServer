const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const router = express.Router();
const nodemailer = require("nodemailer");
const passport = require("passport");
const crypto = require("crypto");
const Token = require("../models/Token");
const axios = require("axios");
const LinkToken = require("./LinkToken");
const { default: mongoose } = require("mongoose");
router.get("/", async (req, res) => {
  res.send({ msg: "connected" });
});

// =============== GoogleSigUP ===============
// Google login route
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google callback
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false }),
  (req, res) => {
    const token = jwt.sign({ id: req.user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.redirect(`${process.env.CLIENT_URL}/auth/success?token=${token}`);
  }
);

// =============== SIGNUP ===============
router.post("/signup", async (req, res) => {
  const { userName, email, password, telegramId } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "User already exists, Login" });

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({
      email,
      password: hashedPassword,
      userName,
      telegramId: "",
    });
    await newUser.save();
    res.status(201).json({ message: "User created successfully", newUser });
  } catch (error) {
    res.status(500).json({ message: "Error creating user" });
  }
});

// =============== LOGIN ===============
// =============== LOGIN ===============
router.post("/login", async (req, res) => {
  const { email, password, telegramId } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    // Check if the user is active
    if (!user.active) {
      return res.status(400).json({ message: "Your account is deactivated" });
    }

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
// GET /login/telegram?token=xyz
router.get("/login/telegram", async (req, res) => {
  const { token } = req.query;

  try {
    const linkToken = await LinkToken.findOne({ token, used: false });
    if (!linkToken || linkToken.expiresAt < Date.now()) {
      return res.status(400).send("❌ Link expired or invalid");
    }

    const user = await User.findById(linkToken.userId);
    if (!user) return res.status(400).send("❌ User not found");

    // Mark token as used
    linkToken.used = true;
    await linkToken.save();

    // Generate JWT for website
    const jwtToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // Redirect to website frontend with JWT
    res.redirect(`${process.env.API}/?telegramToken=${jwtToken}`);
  } catch (err) {
    console.error("Telegram login error:", err);
    res.status(500).send("❌ Something went wrong");
  }
});

router.post("/connect/telegram", async (req, res) => {
  const { userId } = req.body;

  console.log("[Connect Telegram] Called with userId:", userId);

  try {
    // 1️⃣ Validate userId
    if (!userId) {
      return res.status(400).json({ message: "Missing userId in request" });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    // 2️⃣ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3️⃣ Generate one-time token
    const token = Math.random().toString(36).substr(2, 10) + Date.now();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // 4️⃣ Save token in DB
    const linkToken = await LinkToken.create({ token, userId, expiresAt });
    console.log("[Connect Telegram] LinkToken created:", linkToken);

    // 5️⃣ Return Telegram deep link
    const deepLink = `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${token}`;
    return res.json({ deepLink });
  } catch (err) {
    console.error("[Connect Telegram] Error:", err);
    return res.status(500).json({
      message: "Failed to generate Telegram link",
      error: err.message,
    });
  }
});
// =============== DEACTIVATE USER ===============
router.put("/deactivateUser/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Find the user by ID
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Deactivate the user by setting `active` to false
    user.active = false;

    await user.save();

    res.status(200).json({ message: "User deactivated successfully", user });
  } catch (error) {
    console.error("Error deactivating user:", error);
    res.status(500).json({ message: "Error deactivating user" });
  }
});
// =============== REACTIVATE USER ===============
router.put("/reactivateUser/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Find the user by ID
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Reactivate the user by setting `active` to true
    user.active = true;

    await user.save();

    res.status(200).json({ message: "User reactivated successfully", user });
  } catch (error) {
    console.error("Error reactivating user:", error);
    res.status(500).json({ message: "Error reactivating user" });
  }
});

// =============== DEPOSIT ===============
router.post("/deposit", async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ message: "User not found" });

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

router.put("/addBetHistory/:userId", async (req, res) => {
  const { userId } = req.params;
  const {
    gameContent,
    gameName,
    gameDate,
    gameId,
    tipOdd,
    image,
    tipName,
    tipPrice,
    status,
  } = req.body;

  try {
    // Find the user by ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Create a new bet entry
    const newBet = {
      gameId,
      gameContent,
      image,
      gameName,
      gameDate,
      tipOdd,
      tipName,
      tipPrice,
      status,
    };

    // Add the new bet to the user's bet history
    user.betHistory.push(newBet);

    // Save the updated user document
    await user.save();

    res.status(200).json({
      message: "Bet history updated successfully",
      betHistory: user.betHistory,
    });
  } catch (error) {
    console.error("Error adding bet to history:", error);
    res.status(500).json({ message: "Error adding bet to history" });
  }
});

router.post("/updateBalance", async (req, res) => {
  const { userId, amount } = req.body;

  try {
    // Find the user by ID
    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ message: "User not found" });

    // Deduct the amount from the user's balance
    user.availableBalance -= parseFloat(amount);

    // Save the updated user document
    await user.save();

    // Send response back to frontend
    res.status(200).json({
      message: "Balance updated successfully",
      availableBalance: user.availableBalance,
    });
  } catch (error) {
    console.error("Error updating balance:", error);
    res.status(500).json({ message: "Error updating balance" });
  }
});

// =============== GET ALL USERS ===============
router.get("/getUsers", async (req, res) => {
  try {
    const users = await User.find();
    res.send({ users });
  } catch (error) {
    res.send({ success: false, msg: "error fetching users" });
  }
});
// PUT /api/auth/updateUserRole/:id
router.put("/updateUserRole/:id", async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    // Validate input
    if (!role) {
      return res.status(400).json({ message: "Role is required" });
    }

    // Find and update the user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "User role updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user role:", error);
    res.status(500).json({ message: "Server error" });
  }
});
router.get("/telegram-login", async (req, res) => {
  const { token } = req.query;
  const link = await LinkToken.findOne({ token, used: false });

  if (!link || link.expiresAt < new Date())
    return res.status(400).send("Invalid or expired token");

  const user = await User.findOne({ telegramId: link.telegramId });
  if (!user) return res.status(404).send("User not found");

  const jwtToken = jwt.sign({ userId: user._id }, "secretKey", {
    expiresIn: "1h",
  });
  link.used = true;
  await link.save();

  // Redirect to frontend with token
  res.redirect(`https://yourfrontend.com?token=${jwtToken}`);
});

// Get single user by ID
router.get("/getUser/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "userName email availableBalance role telegramId"
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ success: true, user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
});

// Telegram Signup Route
router.post("/telegram-signup", async (req, res) => {
  try {
    const { telegramId, userName, email } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });

    if (user) {
      return res.status(200).json({
        message: "User already exists",
        userId: user._id, // ✅ include the MongoDB _id
        user,
      });
    }

    // Create new user (no password needed)
    const newUser = new User({
      userName,
      email,
      password: "telegram_user", // dummy password
      telegramId, // store Telegram ID here
    });

    await newUser.save();

    // ✅ Return MongoDB _id and user object
    res.status(201).json({
      message: "Telegram user created",
      userId: newUser._id,
      user: newUser,
    });
  } catch (error) {
    console.error("Error creating Telegram user:", error);
    res.status(500).json({ message: "Error creating Telegram user" });
  }
});

router.get("/getUserById/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// =============== DELETE USER ===============
router.delete("/deleteUser/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser)
      return res.status(404).json({ message: "User not found" });
    res.status(200).json({ message: "User deleted successfully", deletedUser });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Error deleting user" });
  }
});

// =============== FORGOT PASSWORD ===============
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, msg: "User doesn't exist" });
    }

    // Delete any existing token for this user
    await Token.findOneAndDelete({ userid: user._id });

    // Generate new token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenDoc = await new Token({
      userid: user._id,
      token: resetToken,
    }).save();

    // Construct reset link
    const resetLink = `${process.env.URL}/${user._id}/${resetToken}`;

    // Nodemailer setup
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // Use your email
        pass: process.env.EMAIL_PASS,
      },
    });

    // Send email
    const mailOptions = {
      from: "no-reply@sportstips.com", // Use a 'no-reply' address
      to: email,
      subject: "Password Reset - SportsTips",
      html: `
    <div style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px; max-width: 600px; margin: 0 auto; border-radius: 8px;">
      <h1 style="text-align: center; color: #4b6cb7;">Reset Your Password</h1>
      <p style="font-size: 16px; color: #555;">Hi ${user.userName}👋,</p>
      <p style="font-size: 16px; color: #555;">Tap the button below to reset your customer account password. If you didn't request a new password, you can safely delete this email.</p>
      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env.API}/api/auth/reset-password/${user._id}/${resetToken}" style="background-color: #4b6cb7; color: #ffffff; padding: 14px 25px; text-decoration: none; font-size: 16px; border-radius: 5px; display: inline-block;">Reset Password</a>
      </div>
      <p style="font-size: 14px; color: #555; margin-top: 20px; text-align: center;">If the button doesn't work, copy and paste the following link into your browser:</p>
      <p style="font-size: 14px; color: #4b6cb7; text-align: center;">
        <a href="${process.env.API}/api/auth/reset-password/${user._id}/${resetToken}" style="color: #4b6cb7;">${process.env.API}/api/auth/reset-password/${user._id}/${resetToken}</a>
      </p>
      <p style="font-size: 14px; color: #555; text-align: center; margin-top: 40px;">Thank you,</p>
      <p style="font-size: 14px; color: #555; text-align: center;">The SportsTips Team</p>
    </div>
  `,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, msg: "Reset link sent to your email" });
  } catch (error) {
    console.error("Error processing password reset:", error);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ===== RESET PASSWORD =====
router.post("/reset-password/:id/:token", async (req, res) => {
  const { id, token } = req.params;
  const { password } = req.body;

  try {
    const tokenDoc = await Token.findOne({ userid: id, token });
    if (!tokenDoc) {
      return res
        .status(400)
        .json({ success: false, msg: "Invalid or expired token" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, msg: "User not found" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    // Delete used token
    await Token.findByIdAndDelete(tokenDoc._id);

    res.json({ success: true, msg: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

//ox payment

router.post("/create-oxpay", async (req, res) => {
  try {
    const { amount, userId } = req.body;

    // Example: call OxPay API (replace with real credentials)
    const response = await axios.post("https://api.oxpay.com/v1/payment", {
      amount,
      currency: "USD",
      description: `Deposit for user ${userId}`,
      callback_url: "https://your-backend.com/api/payment/oxpay-callback",
    });

    const payment = await PaymentModel.create({
      userId,
      paymentId: response.data.payment_id,
      amount,
      status: "pending",
    });

    res.json({
      paymentUrl: response.data.payment_url,
      paymentId: payment.paymentId,
    });
  } catch (error) {
    console.error("OxPay error:", error);
    res.status(500).json({ message: "Failed to create payment." });
  }
});

// Webhook (OxPay callback)
router.post("/oxpay-callback", async (req, res) => {
  try {
    const { payment_id, status } = req.body;

    if (status === "success") {
      const payment = await PaymentModel.findOneAndUpdate(
        { paymentId: payment_id },
        { status: "success" },
        { new: true }
      );

      // Update user balance here (optional)
      // await UserModel.findByIdAndUpdate(payment.userId, { $inc: { balance: payment.amount } });

      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({ success: false });
  }
});

// Check payment status
router.get("/status/:id", async (req, res) => {
  const payment = await PaymentModel.findOne({ paymentId: req.params.id });
  res.json({ success: payment?.status === "success" });
});

module.exports = router;
