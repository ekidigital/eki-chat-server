import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  chatRooms: {
    type: [String],
    ref: "ChatRooms",
  },
  status: {
    type: String,
    default: "offline",
  },
  contacts: {
    type: [String],
    ref: "User",
    default: [],
  },
  devices: [
    {
      expoPushToken: String, // Store push token
      platform: String, // iOS or Android
      lastUsed: { type: Date, default: Date.now },
    },
  ],
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("User", UserSchema);
