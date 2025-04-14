const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: String,
  runs: Number,
  balls: Number,
  fours: Number,
  sixes: Number,
  sr: Number,
  howOut: String
});

const bowlerSchema = new mongoose.Schema({
  name: String,
  overs: String,
  runs: Number,
  wickets: Number,
  eco: Number,
  dots: Number,
  fours: Number,
  sixes: Number,
  wd: Number,
  nb: Number
});

const inningsSchema = new mongoose.Schema({
  team: String,
  total: String,
  overs: String,
  runRate: Number,
  players: [playerSchema],
  extras: String,
  fallOfWickets: String,
  bowlers: [bowlerSchema]
});

const scorecardSchema = new mongoose.Schema({
  matchTitle: String,
  venue: String,
  date: String,
  toss: String,
  result: String,
  playerOfTheMatch: String,
  matchId: String,
  innings: [inningsSchema]
});

module.exports = mongoose.model('ScoreCard', scorecardSchema);