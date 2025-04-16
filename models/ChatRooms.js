import mongoose from 'mongoose';

const ChatRoomSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    default: "single",
    required: true,
  },
  messages: [
    {
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        default: () => new mongoose.Types.ObjectId(),  // Generate a unique ID for each message
      },
      sender: { type: String, required: true, ref: "User" },
      receiver: { type: String, ref: "User" },
      stat: { type: String, required: true, default: "sent" },
      message: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      readBy: { type: [String], default: [] },
    },
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
  members: {
    type: [String],
    ref: "User",
    default: []
  },
  readBy: {
    type: [String],
    ref: "User",
    default: [],
  },
  roomDetails: {},
});

export default mongoose.model('ChatRooms', ChatRoomSchema);
