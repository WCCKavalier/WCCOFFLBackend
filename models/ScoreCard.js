const mongoose = require("mongoose");

const batsmanSchema = new mongoose.Schema({
  name: String,
  runs: Number,
  balls: Number,
  fours: Number,
  sixes: Number,
  sr: Number,
  outDesc: String
});

const bowlerSchema = new mongoose.Schema({
  name: String,
  overs: Number,
  maidens: Number,     // 🔄 New field
  runs: Number,
  wickets: Number,
  eco: Number,
  dots: Number,        // 🔄 New field ("0s")
  fours: Number,       // 🔄 New field
  sixes: Number,       // 🔄 New field
  wd: Number,          // 🔄 New field
  nb: Number           // 🔄 New field
});

const inningsSchema = new mongoose.Schema({
  team: String,
  total: String,
  overs: String,
  runRate: String,
  extras: String,         // 🔄 New field (e.g. "Extras (WD 3, NB 1)")
  batsmen: [batsmanSchema],
  bowlers: [bowlerSchema],
  fallOfWickets: [String]
});

const matchSchema = new mongoose.Schema({
  matchInfo: {
    teams: [String],
    date: String,
    venue: String,
    format: String,
    toss: String,
    result: String,
    playerOfMatch: String
  },
  innings: [inningsSchema]
},{
  timestamps: true 
});

module.exports = mongoose.model("ScoreCard", matchSchema);
