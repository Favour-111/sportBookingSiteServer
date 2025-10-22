const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const gameRoutes = require("./routes/gameRoutes");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// Initialize Socket.IO
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: "*", // Allow your frontend origin here for production
  },
});

// Store the socket.io instance globally so routes can use it
app.set("io", io);

// Test socket connection
io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// Routes
app.use("/api/game", gameRoutes);

// Start server
const PORT = 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
