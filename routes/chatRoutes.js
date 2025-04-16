import express from "express";
import User from "../models/User.js";
import ChatRooms from "../models/ChatRooms.js";
import mongoose from "mongoose";
import { AccessToken } from "livekit-server-sdk";

const router = express.Router();



const API_KEY = "devkey";
const API_SECRET = "livekit-secret-key-123456789-abcdefghij";
const LIVEKIT_URL = "ws://192.168.205.210:7880";

async function generateToken(roomName, userId) {
  const token = new AccessToken(API_KEY, API_SECRET, { identity: userId, ttl: "20m" });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true,
    canSubscribe: true, });
  return token.toJwt();
}

router.post("/get-call-token", async (req, res) => {
  const { room, user } = req.body;
  if (!room || !user) return res.status(400).json({ error: "Invalid input" });
  console.log("activated token");
  

  const token = await generateToken(room, user);
  console.log(token);
  

  res.json({ token, room, server: LIVEKIT_URL });
});


// Get unread messages for each room
router.get("/unread/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Fetch user from database
    const user = await User.findOne({ code: userId });

    if (!user) {
      throw new Error("User not found");
    }

    // Declare and initialize chatRooms
    // Get all rooms where user is a member
    const allChatRooms = await ChatRooms.find({
      members: userId, // Ensure correct query condition
    });

    // Calculate unread messages for each chat room
    const unreadMessages = allChatRooms.map((room) => {
      const unreadCount = room.messages.filter(
        (message) => !message.readBy.includes(userId)
      ).length;

      return {
        roomId: room.roomId,
        unreadCount,
      };
    });

    res.status(200).json(unreadMessages);
  } catch (error) {
    console.error("Error fetching unread messages:", error);
    res.status(500).json({ error: "Failed to fetch unread messages" });
  }
});

// Get unread messages for each room
router.get("/user/find?email", async (req, res) => {
  const { email } = req.query;

  try {
    // Fetch user from database
    const user = await User.findOne({ email });

    if (!user) {
    }

    if (!user) {
      res.status(404).json({ error: "User doesn't exist!" });
    }

    res.status(200).json({ status: "success", data: user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

// Get user
router.get("/get/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Fetch user from database
    const user = await User.findOne({ code: userId });

    if (!user) {
      throw new Error("User not found");
    }

    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user chat account:", error);
    res.status(500).json({ error: "Failed to fetch user chat account" });
  }
});

// Add user to contacts
router.post("/add-to-contacts/:userId", async (req, res) => {
  const { userId } = req.params; // ID of the user adding to contacts
  const { contactId } = req.body; // ID of the user to be added as a contact

  try {
    // Fetch the user adding the contact
    if (userId === contactId)
      return res.status(404).json({ error: "You can't add yourself" });

    const user = await User.findOne({ code: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch the user to be added as a contact
    const contact = await User.findOne({ code: contactId });
    if (!contact) {
      return res.status(404).json({ error: "Contact not found" });
    }

    // Check if the contact already exists
    if (user.contacts?.includes(contactId)) {
      return res.status(400).json({ message: "Contact already exists" });
    }

    // Add the contact
    await User.updateOne({ code: userId }, { $push: { contacts: contactId } });

    res
      .status(200)
      .json({ message: "Contact added successfully", data: user?.contacts });
  } catch (error) {
    console.error("Error adding contact:", error);
    res.status(500).json({ error: "Failed to add contact" });
  }
});

// Delete user and remove from chat rooms
router.delete("/delete/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Fetch the user to ensure they exist
    const user = await User.findOne({ code: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Remove the user as a member from all chat rooms they are part of
    await ChatRooms.updateMany(
      { members: userId },
      { $pull: { members: userId } }
    );

    // Remove the user from the database
    await User.deleteOne({ code: userId });

    res
      .status(200)
      .json({
        message: "User and associated memberships removed successfully",
      });
  } catch (error) {
    console.error("Error deleting user and removing memberships:", error);
    res
      .status(500)
      .json({ error: "Failed to delete user and remove memberships" });
  }
});

function generateRandomString() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 10; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Create a new chat room
router.post("/create-room", async (req, res) => {
  const { type, userId, roomDetails } = req.body;
  console.log("----------", roomDetails);

  const roomId = generateRandomString();

  try {
    // Fetch user from database
    const user = await User.findOne({ code: userId });

    if (!user) {
      throw new Error("User not found");
    }

    // Check if the chat room already exists
    const existingRoom = await ChatRooms.findOne({ roomId });
    if (existingRoom) {
      return res.status(400).json({ error: "Chat room already exists" });
    }

    // Create a new chat room
    const chatRoom = await ChatRooms.create({
      roomId,
      type,
      members: [userId], // Members array with user IDs
      messages: [], // Start with an empty message list
      readBy: [], // Empty readBy array initially
      roomDetails: roomDetails,
    });

    user.chatRooms.push(chatRoom["roomId"]);

    await user.save();

    res
      .status(201)
      .json({ message: "Chat room created successfully", chatRoom });
  } catch (error) {
    console.error("Error creating chat room:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Edit an existing chat room
router.patch("/edit-room/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { roomDetails } = req.body;

  try {
    // Find and update the chat room
    const updatedRoom = await ChatRooms.findOneAndUpdate(
      { roomId },
      {
        $set: {
          ...(roomDetails && { roomDetails }), // Update roomDetails if provided
        },
      },
      { new: true } // Return the updated document
    );

    if (!updatedRoom) {
      return res.status(404).json({ error: "Chat room not found" });
    }

    res
      .status(200)
      .json({ message: "Chat room updated successfully", updatedRoom });
  } catch (error) {
    console.error("Error editing chat room:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Exit a group chat
router.patch("/exit-room/:userId/:roomId", async (req, res) => {
  const { userId, roomId } = req.params;

  try {
    // Fetch the chat room
    const chatRoom = await ChatRooms.findOne({ roomId });
    if (!chatRoom) {
      return res.status(404).json({ error: "Chat room not found" });
    }

    // Check if the user is in the room
    if (!chatRoom?.members.includes(userId)) {
      return res
        .status(403)
        .json({ error: "User is not a member of this room" });
    }

    // Check if the user is the only admin
    const isAdmin =
      chatRoom?.roomDetails?.groupAdmins &&
      chatRoom?.roomDetails?.groupAdmins?.find({ userId });
    const otherAdmins = chatRoom?.roomDetails?.groupAdmins?.filter(
      (admin) => admin !== userId
    );

    if (
      chatRoom?.roomDetails?.groupAdmins?.includes(userId) &&
      chatRoom?.roomDetails?.groupAdmins?.length > 1 &&
      otherAdmins.length === 0 &&
      chatRoom?.members?.length > 1
    ) {
      return res
        .status(403)
        .json({ error: "You cannot exit the room as the only admin" });
    }

    // Remove the user from the room's members
    chatRoom.members = chatRoom?.members.filter((member) => member !== userId);

    // If the user is an admin, remove them from admins
    if (isAdmin) {
      chatRoom.roomDetails.groupAdmins = otherAdmins;
    }

    // Save the updated room
    await chatRoom.save();

    // Fetch the user and update their chatRooms
    const user = await User.findOneAndUpdate(
      { code: userId },
      { $pull: { chatRooms: roomId } }, // Remove roomId from user's chatRooms
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      message: "Successfully exited the room",
      updatedRoom: chatRoom,
    });
  } catch (error) {
    console.error("Error exiting chat room:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add a user to a chat room (Admins Only)
router.patch("/add-user/:roomId/:adminId", async (req, res) => {
  const { roomId, adminId } = req.params;
  const { userId } = req.body; // User to add

  try {
    // Find the chat room
    const chatRoom = await ChatRooms.findOne({ roomId });

    if (!chatRoom) {
      return res.status(404).json({ error: "Chat room not found" });
    }

    // Check if the adminId is in the admin list
    if (!chatRoom.roomDetails.groupAdmins.includes(adminId)) {
      return res
        .status(403)
        .json({ error: "Only admins can add users to this room" });
    }

    // Add the user to the room's members if not already present
    if (!chatRoom.members.includes(userId)) {
      chatRoom.members.push(userId);
      await chatRoom.save();
    }

    // Add the roomId to the user's chatRooms list
    await User.findOneAndUpdate(
      { code: userId },
      { $addToSet: { chatRooms: roomId } },
      { new: true, upsert: true } // Create user if not exists
    );

    res
      .status(200)
      .json({ message: "User added to chat room successfully", chatRoom });
  } catch (error) {
    console.error("Error adding user to chat room:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Remove a user from a chat room (Admins Only)
router.patch("/remove-user/:roomId/:adminId", async (req, res) => {
  const { roomId, adminId } = req.params;
  const { userId } = req.body; // User to remove

  try {
    // Find the chat room
    const chatRoom = await ChatRooms.findOne({ roomId });

    if (!chatRoom) {
      return res.status(404).json({ error: "Chat room not found" });
    }

    // Check if the adminId is in the admin list
    if (!chatRoom?.roomDetails?.groupAdmins?.includes(adminId)) {
      return res
        .status(403)
        .json({ error: "Only admins can remove users from this room" });
    }

    if (
      chatRoom?.roomDetails?.groupAdmins?.includes(userId) &&
      !chatRoom?.roomDetails?.groupAdmins?.length > 1
    ) {
      return res
        .status(403)
        .json({ error: "You are the only admin in this room" });
    }

    // Remove the user from the room's members list
    chatRoom.members = chatRoom?.members?.filter((member) => member !== userId);
    await chatRoom.save();

    // Remove the roomId from the user's chatRooms list
    await User.findOneAndUpdate(
      { code: userId },
      { $pull: { chatRooms: roomId } }, // Remove roomId from chatRooms
      { new: true }
    );

    res
      .status(200)
      .json({ message: "User removed from chat room successfully", chatRoom });
  } catch (error) {
    console.error("Error removing user from chat room:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get chat room by id
router.get("/get-room/:userId/:roomId", async (req, res) => {
  const { userId, roomId } = req.params;
  const { otherUserId } = req.query;

  try {
    // Fetch user from database
    const user = await User.findOne({ code: userId });

    const user2 = await User.findOne({ code: otherUserId });

    if (!user) {
      throw new Error("User not found");
    }

    // Fetch the room details with its messages
    let chatRoom = await ChatRooms.findOne({ roomId }).lean();
    if (!chatRoom) {
      chatRoom = await ChatRooms.create({
        roomId,
        type: "single",
        messages: [],
        members: [userId, otherUserId], // Automatically include sender and receiver
        readBy: [], // Initially read by the sender
      });
    }

    // Sort messages by timestamp (latest first)
    chatRoom.messages = chatRoom.messages.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.status(200).json(chatRoom);
  } catch (error) {
    console.error("Error retrieving room and messages:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint to get the roomId of a chat between two users
router.get("/chatroom-id", async (req, res) => {
  const { userId, otherUserId } = req.query;

  // Validate the query parameters
  if (!userId || !otherUserId) {
    return res
      .status(400)
      .json({ message: "Both userId and otherUserId are required" });
  }

  try {
    // Find the room where both IDs are present in the members array
    const chatRoom = await ChatRooms.findOne({
      members: { $all: [userId, otherUserId] },
    }).select("roomId");

    if (!chatRoom) {
      return res
        .status(200)
        .json({ roomId: [userId, otherUserId].sort().join("_") });
    }

    // Respond with the roomId
    res.status(200).json({ roomId: chatRoom.roomId });
  } catch (error) {
    console.error("Error fetching chat room:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get last message in each room for a user
router.get("/last-message/:userId", async (req, res) => {
  const { userId } = req.params;
  console.log(userId);

  try {
    // Fetch user
    const user = await User.findOne({ code: userId });

    if (!user) {
      throw new Error("User not found");
    }

    // Fetch all chat rooms associated with the user
    const allChatRooms = await ChatRooms.find({
      members: userId,
    });

    if (!allChatRooms || allChatRooms.length === 0) {
      return res.status(404).json({ message: "No chat rooms found" });
    }

    // Format chat rooms with latest message
    const formattedRooms = allChatRooms.map((room) => ({
      roomId: room.roomId,
      type: room.type,
      roomDetails: room.roomDetails,
      latestMessage: room.messages.length > 0 ? room.messages[room.messages.length - 1] : null, // Last message
    }));

    // Sort rooms by latestMessage timestamp (descending order)
    formattedRooms.sort((a, b) => {
      const timeA = a.latestMessage ? new Date(a.latestMessage.timestamp).getTime() : 0;
      const timeB = b.latestMessage ? new Date(b.latestMessage.timestamp).getTime() : 0;
      return timeB - timeA; // Latest messages first
    });

    // Final response formatting
    const formattedResponse = formattedRooms.map((room) => ({
      roomId: room.roomId,
      type: room.type,
      roomDetails: room.roomDetails,
      latestMessage: room.latestMessage
        ? {
            messageId: room.latestMessage.messageId,
            sender: room.latestMessage.sender,
            receiver: room.latestMessage.receiver,
            message: room.latestMessage.message,
            timestamp: room.latestMessage.timestamp,
          }
        : null, // Handle rooms with no messages
    }));

    console.log(formattedResponse);
    res.status(200).json(formattedResponse);
  } catch (error) {
    console.error("Error fetching last messages:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});


// Get all users chat rooms
router.get("/:userId/rooms", async (req, res) => {
  const { userId } = req.params;

  try {
    // Find the user and populate their chat rooms
    const user = await User.findOne({ code: userId }).populate("chatRooms");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Return only the room IDs
    res.status(200).json(user.chatRooms.map((room) => room.roomId));
  } catch (error) {
    console.error("Error retrieving user rooms:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// routes/chatRoutes.js
router.post("/markAsRead", async (req, res) => {
  const { roomId, userId } = req.body;

  try {
    await ChatMessage.updateMany(
      { roomId: roomId, readBy: { $ne: mongoose.Types.ObjectId(userId) } },
      { $push: { readBy: userId } } // Mark as read
    );

    res.status(200).json({ message: "Messages marked as read" });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

export default router;
