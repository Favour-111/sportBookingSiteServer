const express = require("express");
const Message = require("../models/Message");

const router = express.Router();

// Route to add a new broadcast message
router.post("/addMessage", async (req, res) => {
  try {
    const { title, message, visibility } = req.body;

    // Check if required fields are present
    if (!title || !message || !visibility) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const newMessage = new Message({
      title,
      message,
      visibility,
    });

    await newMessage.save();
    res.status(201).json({ message: "Message added successfully", newMessage });
  } catch (error) {
    console.error("Error adding message:", error);
    res
      .status(500)
      .json({ message: "Error adding message", error: error.message });
  }
});
//geting all message
router.get("/getallMessage", async (req, res) => {
  const response = await Message.find();
  if (response) {
    res.send({
      response,
    });
  } else {
    res.send({
      message: "error fetching messages",
    });
  }
});
// Route to delete a message
router.delete("/deleteMessage/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const message = await Message.findByIdAndDelete(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ message: "Error deleting message" });
  }
});

// Route to deactivate a message
router.put("/deactivateMessage/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Toggle visibility
    message.visibility =
      message.visibility === "Visible" ? "Hidden" : "Visible";
    await message.save();

    res.status(200).json({ message: "Message visibility updated", message });
  } catch (error) {
    console.error("Error updating message visibility:", error);
    res.status(500).json({ message: "Error updating message visibility" });
  }
});
module.exports = router;
