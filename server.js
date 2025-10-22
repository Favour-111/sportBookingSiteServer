const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

// Routes
const authRoutes = require("./routes/auth");
const gameRoutes = require("./routes/game");
const messageRoutes = require("./routes/message");
const paymentRoutes = require("./routes/payment");
const oxapayRoutes = require("./routes/Oxpay");
dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // ⚠️ Replace with your frontend URL in production
  },
});

// Make socket.io accessible to all routes
app.set("io", io);

// ✅ Handle socket connections
io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  // Example custom events
  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/games", gameRoutes);
app.use("/api/message", messageRoutes);
// app.use("/api/payments", paymentRoutes);
app.use("/api/payment", oxapayRoutes);

// ✅ MongoDB connection
mongoose
  .connect(process.env.URL)
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
