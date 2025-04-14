const express = require("express");
const router = express.Router();
const Team = require("../models/Team");
const SeriesHistory = require("../models/SeriesHistory");

// Update Points API (Starts series if first win)
router.put('/update-points', async (req, res) => {
    try {
        const { winnerId } = req.body;
        const loserId = winnerId === 'team1' ? 'team2' : 'team1';

        const winner = await Team.findOne({ teamId: winnerId });
        const loser = await Team.findOne({ teamId: loserId });

        if (!winner || !loser) {
            return res.status(404).json({ message: "Teams not found" });
        }

        // Set start date only if it's the first win in the series
        if (winner.points === 0 && loser.points === 0) {
            winner.startDate = new Date();
            loser.startDate = new Date();
        }

        // Update points and scores
        winner.points += 1;
        winner.score.push("W");
        loser.score.push("L");
        if (winner.score.length > 15) winner.score.shift();
        if (loser.score.length > 15) loser.score.shift();

        await winner.save();
        await loser.save();

        res.json({ winner, loser });
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
    }
});

router.get("/series-history", async (req, res) => {
    try {
        // Fetch all series history sorted by endDate (latest first)
        const seriesHistory = await SeriesHistory.find().sort({ endDate: -1 });

        if (!seriesHistory.length) {
            return res.json({ seriesHistory: [] });
        }

        // Format series history to ensure proper team names are included
        const formattedSeriesHistory = seriesHistory.map((entry) => ({
            teams: entry.teams,
            captain: entry.captain,
            score: entry.score,
            points: entry.points,
            startDate: entry.startDate,
            endDate: entry.endDate,
        }));

        res.json({ seriesHistory: formattedSeriesHistory });
    } catch (error) {
        console.error("Error fetching series history:", error);
        res.status(500).json({ error: "Database error" });
    }
});




router.put("/revert", async (req, res) => {
    try {
        const { lastWinnerId } = req.body;
        const lastLoserId = lastWinnerId === "team1" ? "team2" : "team1";

        const lastWinner = await Team.findOne({ teamId: lastWinnerId });
        const lastLoser = await Team.findOne({ teamId: lastLoserId });

        if (!lastWinner || !lastLoser || lastWinner.score.length === 0 || lastLoser.score.length === 0) {
            return res.status(400).json({ message: "No history to revert" });
        }

        // Remove last recorded match result
        lastWinner.points = Math.max(0, lastWinner.points - 1);
        lastWinner.score.pop();
        lastLoser.score.pop();

        await lastWinner.save();
        await lastLoser.save();

        res.json({ message: "Last result reverted successfully!", lastWinner, lastLoser });
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error });
    }
});

const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = (`0${d.getMonth() + 1}`).slice(-2);
  const day = (`0${d.getDate()}`).slice(-2);
  return `${year}${month}${day}`;
};

// End Series API
router.post("/end-series", async (req, res) => {
    try {
        const teams = await Team.find({ teamId: { $in: ["team1", "team2"] } });

        if (teams.length !== 2) {
            return res.status(400).json({ error: "Both teams must exist in the database." });
        }

        const [team1, team2] = teams;
        let winningCaptain = "";
        let winningTeamName = "";
        
        if (team1.points > team2.points) {
            winningCaptain = team1.captain;
            winningTeamName = team1.teamName;
        } else if (team2.points > team1.points) {
            winningCaptain = team2.captain;
            winningTeamName = team2.teamName;
        } else {
            winningCaptain = "Draw";
            winningTeamName = "Draw";
        }

        const endDate = new Date();
        const formattedDate = formatDate(team1.startDate); 

        // Save previous series in separate collection
        await SeriesHistory.create({
            teams: {
                teamA: `${team1.teamName}${formattedDate}`,
                teamB: `${team2.teamName}${formattedDate}`
            },
            captain: {
                teamA: team1.captain,
                teamB: team2.captain
            },
            score: {
                teamA: team1.score, 
                teamB: team2.score  
            },  
            points: {
                teamA: team1.points,
                teamB: team2.points
            },
            startDate: team1.startDate,  // Assuming both teams have the same start date
            endDate: endDate
        });

        // Reset team stats
        await Promise.all([
            Team.findOneAndUpdate(
                { teamId: "team1" },
                { points: 0, score: Array(15).fill("-"), startDate: null }
            ),
            Team.findOneAndUpdate(
                { teamId: "team2" },
                { points: 0, score: Array(15).fill("-"), startDate: null }
            )
        ]);

        return res.json({
            message: "Series ended successfully!",
            winner: { captain: winningCaptain, team: winningTeamName }
        });
    } catch (error) {
        console.error("Error ending series:", error);
        res.status(500).json({ error: "Database error" });
    }
});

router.post("/filter-series", async (req, res) => {
    try {
      const filters = req.body;
      const allSeries = await SeriesHistory.find({});
      let filteredSeries = allSeries;
  
      Object.entries(filters).forEach(([key, value]) => {
        if (key === "date") {
          const { startDate, endDate } = value;
  
          if (startDate && endDate) {
            filteredSeries = filteredSeries.filter(series => {
              const seriesStart = new Date(series.startDate).toISOString().split("T")[0];
              return seriesStart >= startDate && seriesStart <= endDate;
            });
          } else if (startDate) {
            filteredSeries = filteredSeries.filter(series => {
              const seriesStart = new Date(series.startDate).toISOString().split("T")[0];
              return seriesStart === startDate;
            });
          } else if (endDate) {
            filteredSeries = filteredSeries.filter(series => {
              const seriesEnd = new Date(series.endDate).toISOString().split("T")[0];
              return seriesEnd === endDate;
            });
          }
  
        } else if (key === "Series Name") {
          filteredSeries = filteredSeries.filter(series =>
            series.teams.teamA === value || series.teams.teamB === value
          );
        } else if (key === "Captains") {
          filteredSeries = filteredSeries.filter(series =>
            series.captain.teamA === value || series.captain.teamB === value
          );
        } else if (key === "Winning captain") {
          if (value === "Draw") {
            filteredSeries = filteredSeries.filter(series => series.points.teamA === series.points.teamB);
          } else {
            filteredSeries = filteredSeries.filter(series => {
              if (series.points.teamA === series.points.teamB) return false;
              const winner = series.points.teamA > series.points.teamB
                ? series.captain.teamA
                : series.captain.teamB;
              return winner === value;
            });
        }
      }
      });
  
      res.json({ history: filteredSeries });
    } catch (err) {
      console.error("Filter error:", err);
      res.status(500).json({ error: "Failed to filter series history" });
    }
  });

  router.post('/add', async (req, res) => {
    try {
        const {
            teams,
            captain,
            score,
            points,
            startDate,
            endDate
        } = req.body;

        // Look for an existing record with same teamA, teamB, and startDate
        const existing = await SeriesHistory.findOne({
            'teams.teamA': teams.teamA,
            'teams.teamB': teams.teamB
        });

        if (existing) {
            // Update the existing document
            existing.captain = captain;
            existing.score = score;
            existing.points = points;
            existing.startDate = startDate;
            existing.endDate = endDate;

            const updated = await existing.save();
            res.status(200).json({ message: 'Series updated', data: updated });
        } else {
            // Create a new one if it doesn't exist
            const newSeries = new SeriesHistory({
                teams,
                captain,
                score,
                points,
                startDate,
                endDate
            });

            const savedSeries = await newSeries.save();
            res.status(201).json({ message: 'Series created', data: savedSeries });
        }
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});
module.exports = router;