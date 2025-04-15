const mongoose = require("mongoose");

const playerStatsSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  batting: {
    matches: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    balls: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    NOs: { type: Number, default: 0 } // New field for Not Outs
  },
  bowling: {
    matches: { type: Number, default: 0 },
    overs: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    economy: { type: Number, default: 0 },
    maidens: { type: Number, default: 0 },
    dots: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    wd: { type: Number, default: 0 },
    nb: { type: Number, default: 0 }
  }
});

module.exports = mongoose.model("PlayerStats", playerStatsSchema);