const mongoose = require('mongoose');
const moment = require('moment-timezone');

const JobLogSchema = new mongoose.Schema({
  timestamp: {
    type: String,
    default: () => moment.tz("Asia/Kolkata").format('YYYY-MM-DD HH:mm:ss'),  // Store as formatted IST string
    expires: 60 * 60 * 24,
  },
  status: { type: String, enum: ['success', 'failure'], required: true },
  message: { type: String },
});

module.exports = mongoose.model('JobLog', JobLogSchema);