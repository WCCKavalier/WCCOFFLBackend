const mongoose = require("mongoose");


const teamSchema = new mongoose.Schema({
    teamId: { type: String, enum: ['team1', 'team2'], unique: true },
    teamName: String,
    captain: String,
    score: { type: [String], default: Array(15).fill('-') },
    points: { type: Number, default: 0 },
    coreTeam: [String],
    startDate: { type: Date, default: null }
});

module.exports = mongoose.model('Team', teamSchema);