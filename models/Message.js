const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  username: String,
  message: String,
  timestamp: { type: Date, default: Date.now , expires: 604800}
});

module.exports = mongoose.model("Message", MessageSchema);
