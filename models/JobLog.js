const mongoose = require('mongoose');
const moment = require('moment-timezone');

const JobLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: () => moment.tz("Asia/Kolkata").toDate(),
    expires: 60 * 60 * 24,  // 24 hours
  },
  status: { type: String, enum: ['success', 'failure'], required: true },
  message: { type: String },
});

module.exports = mongoose.model('JobLog', JobLogSchema);