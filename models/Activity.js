const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // Always 'activityStatus'
  lastActive: {
    type: Date,
    default: Date.now,
    index: { expires: '14m' } // ⏱ Deletes this doc 14 minutes after lastActive
  },
  active: Boolean
});

module.exports = mongoose.model("Activity", activitySchema);
