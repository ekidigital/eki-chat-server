import express from "express";
import http from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import chatRoutes from "./routes/chatRoutes.js";
import dotenv from "dotenv";
import cors from "cors";
import { log } from "console";
import ChatRooms from "./models/ChatRooms.js";
import User from "./models/User.js";
import mongoose from "mongoose";
import sendPushNotifications from "./hooks/sendPushNotifications.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*", // Use environment variable for production
  },
});

export let ioSocket = null;

// Connect to the database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use("/api/chat", chatRoutes);

// User socket mapping for call functionalities
const connectedUsers = new Map(); // Global map to track connected users

// Socket.io connection
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  ioSocket = socket;

  // Listen for the user's unique identifier (e.g., userId)
  socket.on(
    "register",
    async ({ userId, userEmail, expoPushToken, platform }) => {
      if (!userId || !expoPushToken) return;

      try {
        // Fetch the user from the database
        let user = await User.findOne({ code: userId });

        if (!user) {
          user = await User.create({
            code: userId,
            email: userEmail,
            chatRooms: [],
            contacts: [],
            status: "online",
            devices: [{ expoPushToken, platform, lastUsed: new Date() }],
          });
        }

        if (!user?.email) user.email = userEmail;

        if (!user?.devices) {
          user.devices = [{ expoPushToken, platform, lastUsed: new Date() }];
        } else {
          // Check if the device already exists
          const existingDevice = user.devices.find(
            (d) => d.expoPushToken === expoPushToken
          );

          if (existingDevice) {
            existingDevice.lastUsed = new Date(); // Update timestamp
          } else {
            user.devices.push({
              expoPushToken,
              platform,
              lastUsed: new Date(),
            }); // Add new device
          }
        }

        // Update the user's status to online
        user.status = "online";
        await user.save();

        // Assign the user to their personal room
        socket.join(userId);
        connectedUsers.set(userId, socket.id);

        console.log(
          `User ${userId} has joined their personal room and is now online`
        );

        // Notify the user they successfully connected
        socket.emit("registered", {
          message: `Welcome to your personal room, ${userId}`,
          status: user?.status,
        });

        // Optionally, broadcast to others that this user is online
        user.contacts.forEach((contact) => {
          io.to(contact).emit("updateStatus", {
            id: userId,
            status: user.status,
          });
        });
      } catch (error) {
        console.error("Error registering user:", error.message);
        socket.emit("error", { message: "Failed to register user" });
      }
    }
  );

   // Handle offer (start call)
   socket.on("offer", async ({ target, room, localUserId }) => {
    const senderDetails = await User.findOne({ code: localUserId });
    console.log(`Offer from ${localUserId} to ${target}`);

    if (connectedUsers.has(target)) {
        // User is connected, emit directly
        const targetSocketId = connectedUsers.get(target);
        io.to(targetSocketId).emit("incoming-call", { sender: localUserId, room, target });
    } else {
        // User is NOT connected, send push notification
        sendPushNotifications(
            target,
            "Incoming Call",
            `${senderDetails?.email} is calling you!`,
            {
                caller: target,
                room,
                categoryId: "incoming_call",
                actions: [
                    { title: "Accept", action: "accept_call" },
                    { title: "Decline", action: "decline_call" },
                ],
            },
            true
        );
    }
});



  // Handle answer (stop calling)
  socket.on("answer", ({ target, answer, localUserId }) => {
    console.log(`Answer from ${localUserId} to ${target}`);
    
    io.to(target).emit("answerResponse", { sender: localUserId, answer });
  });

  socket.on(
    "sendIceCandidateToSignalingServer",
    ({ target, candidate, localUserId }) => {
      // Forward the candidate and confirm receipt

      if (!localUserId) console.log("local user id not found");

      io.to(target).emit("receivedIceCandidateFromServer", {
        sender: localUserId,
        candidate,
      });

      console.log(`exchange sent from ${localUserId} to ${target}`);
    }
  );

  // Handle call cancelation
  socket.on("cancel-call", ({ target, localUser }) => {
    console.log(`Call canceled by ${localUser}`);
    if (ongoingCalls.has(target)) {
      clearTimeout(ongoingCalls.get(target));
      ongoingCalls.delete(target);
    }
    io.to(target).to(localUser).emit("cancel-call", { sender: localUser });
  });

  // Handle call end
  socket.on("end-call", ({ target, localUser }) => {
    console.log(`Call ended by ${localUser}`);
    io.to(target).to(localUser).emit("end-call", { sender: localUser });
  });

  // ========================== Chat functionalities ============================

  // Join a specific room
  socket.on("joinRoom", ({ roomId }) => {
    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);
    socket.emit("joinRoom", { roomId });
  });

  socket.on("updateReadStatus", async ({ roomId, userId }) => {
    try {
      // Find the chat room
      const chatRoom = await ChatRooms.findOne({ roomId });

      if (!chatRoom) {
        console.error("Chat room not found:", roomId);
        return;
      }

      // Update the `readBy` field for messages that haven't been read by the user
      chatRoom.messages.forEach((message) => {
        if (!message.readBy.includes(userId)) {
          message.readBy.push(userId);
        }
      });

      // Save the updated chat room
      await chatRoom.save();

      // Emit the updated read status to all clients in the room
      io.to(roomId).emit("unreadMessagesUpdated", { userId, roomId });
      console.log("read status updated");
    } catch (error) {
      console.error("Error updating read status:", error);
    }
  });

  socket.on("messageReceived", async ({ newMessage, userId }) => {
    try {
      const { roomId } = newMessage;

      // Find the chat room by its roomId and update all message statuses to 'delivered'
      const chatRoom = await ChatRooms.findOneAndUpdate(
        { roomId }, // Match the room by its ID
        { $set: { "messages.$[].stat": "delivered"} }, // Update `stat` for all elements in the `messages` array
        { new: true } // Return the updated document
      );

      // Update the `readBy` field for messages that haven't been read by the user
      chatRoom.messages.forEach((message) => {
        if (!message.readBy.includes(userId)) {
          message.readBy.push(userId);
        }
      });

      if (!chatRoom) {
        console.error(`Message not found in room ${roomId}`);
        return;
      }

      console.log(`Messages marked as delivered`);

      // Optionally notify the sender about the status update
      chatRoom.members.forEach((member) => {
        io.to(member).emit("messageStatusUpdated", {
          roomId,
          messages: chatRoom?.messages,
        });
      });
    } catch (error) {
      console.error(
        "Error updating message status to delivered:",
        error.message
      );
    }
  });

  socket.on("leaveRoom", ({ roomId }) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
    socket.emit("leaveRoom", { roomId });
  });

  socket.on("sendMessage", async (data) => {
    const { _id, roomId, sender, receiver, message, type } = data;
    const senderDetails = User.findOne({ code: sender });
    try {
      // Generate roomId if not provided
      let id = "";
      if (!roomId && receiver) {
        id = [sender, receiver].sort().join("_");
      } else {
        id = roomId;
      }

      // Find or create the chat room
      let chatRoom = await ChatRooms.findOne({ roomId });

      if (!chatRoom) {
        chatRoom = await ChatRooms.create({
          roomId: id,
          type: "single",
          messages: [],
          members: receiver ? [sender, receiver] : [sender], // Automatically include sender and receiver
          readBy: [sender], // Initially read by the sender
        });
      }

      let newMessage = null;
      if (type === "group") {
        // Add the message to the room's messages array
        newMessage = {
          _id,
          messageId: new mongoose.Types.ObjectId(),
          sender,
          message,
          stat: "sent",
          timestamp: new Date(),
          readBy: [sender], // Initially read by the sender
        };
      } else if (type === "single") {
        // Add the message to the room's messages array
        newMessage = {
          _id,
          messageId: new mongoose.Types.ObjectId(),
          sender,
          receiver,
          message,
          stat: "sent",
          timestamp: new Date(),
          readBy: [sender], // Initially read by the sender
        };
      }

      chatRoom.messages.push(newMessage);

      await chatRoom.save();

      // Create the user if not available or update user if it exists
      const createUserOrUpdateChatRooms = async (
        userCode,
        contactCode,
        chatRoomId
      ) => {
        try {
          await User.findOneAndUpdate(
            { code: userCode },
            {
              $addToSet: {
                chatRooms: chatRoomId,
                contacts: contactCode,
              }, // Add contact and chatRoomId
              $setOnInsert: {
                code: userCode,
                status: "offline",
                timestamp: new Date(),
              }, // Set defaults if user is created
            },
            { upsert: true, new: true } // Create user if not exists, return updated document
          );
        } catch (error) {
          console.error(`Error creating or updating user ${userCode}:`, error);
          throw error;
        }
      };

      if (receiver) {
        // Usage
        await createUserOrUpdateChatRooms(sender, receiver, id);
        await createUserOrUpdateChatRooms(receiver, sender, id);
      } else {
        try {
          await User.findOneAndUpdate(
            { code: sender },
            {
              $addToSet: {
                chatRooms: id,
              },
              $setOnInsert: {
                code: sender,
                status: "offline",
                timestamp: new Date(),
              },
            },
            { upsert: true, new: true }
          );
        } catch (error) {
          console.error(`Error creating or updating user ${sender}:`, error);
          throw error;
        }
      }

      // Emit the new message to the room
      io.to(roomId).emit("receiveMessage", {
        ...newMessage,
        roomId: id, // Emit room ID for tracking
      });

      // Notify listeners about the updated room
      if (type === "single") {
        io.to(sender).to(receiver).to(roomId).emit("messageUpdated", {
          roomId: id,
          message: newMessage,
        });

        // Send push notification to all receiver's devices
        // await sendPushNotifications(
        //   receiver,
        //   senderDetails?.email,
        //   newMessage?.message,
        //   { roomId: id, sender }
        // );
      } else {
        chatRoom.members.forEach(async (member) => {
          io.to(member).emit("messageUpdated", {
            roomId: id,
            message: newMessage,
          });

          // Send push notification to all receiver's devices
          // await sendPushNotifications(
          //   member,
          //   senderDetails?.firstname || senderDetails?.email,
          //   newMessage?.message,
          //   { roomId: id, sender }
          // );
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
    }
  });

  socket.on("disconnect", async ({ userId }) => {
    console.log("Client disconnected:", socket.id);
    if (!userId) return;
    try {
      // Fetch the user from the database
      const user = await User.findOne({ code: userId });

      if (!user) {
        console.error(`User with ID ${userId} not found`);
        socket.emit("error", { message: "User not found" });
        return;
      }

      if (socket.userId) {
        connectedUsers.delete(socket.userId);
        console.log(`User disconnected: ${socket.userId}`);
    }

      // Update the user's status to offline
      user.status = "offline";
      await user.save();

      // Optionally, broadcast to others that this user is online
      user.contacts.forEach((contact) => {
        io.to(contact).emit("updateStatus", {
          id: userId,
          status: user.status,
        });
      });
    } catch (error) {
      console.error("Error turning setting user offline:", error.message);
      socket.emit("error", { message: "Failed to change status user" });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 8004;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
