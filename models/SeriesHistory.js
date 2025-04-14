const mongoose = require("mongoose");


const seriesHistorySchema = new mongoose.Schema({
    teams: {
        teamA: { type: String, required: true },
        teamB: { type: String, required: true }
    },
    captain: {
        teamA: { type: String},
        teamB: { type: String}
    },
    score: {
        teamA: [String],
        teamB: [String]
    },
    points: {
        teamA: { type: Number, default: 0 },
        teamB: { type: Number, default: 0 }
    },
    startDate: Date,
    endDate: Date
});

module.exports = mongoose.model("SeriesHistory", seriesHistorySchema);