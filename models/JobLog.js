const mongoose = require('mongoose');

const JobLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now,expires: 60 * 60 * 24 * 30 },
  status: { type: String, enum: ['success', 'failure'], required: true },
  message: { type: String },
});

module.exports = mongoose.model('JobLog', JobLogSchema);