const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Match = require("../models/ScoreCard");
const PlayerStats = require("../models/PlayerStats");
const { sendNewPlayerEmail } = require("./mailer");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeTeamName(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\d+/g, "").trim();
}

async function extractDataWithAI(text) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `
Parse this STUMPS cricket match report and return JSON in this format:
{
  matchInfo: {
    teams: [team1, team2],
    date: "",
    venue: "",
    format: "",
    toss: "",
    result: "",
    playerOfMatch: ""
  },
  innings: [
    {
      team: "",
      total: "",
      overs: "",
      runRate: "",
      extras: "",
      batsmen: [
        { name: "", runs: 0, balls: 0, fours: 0, sixes: 0, sr: 0.0, outDesc: "" }
      ],
      bowlers: [
        { name: "", overs: 0.0, maidens: 0, runs: 0, wickets: 0, eco: 0.0, dots: 0, fours: 0, sixes: 0, wd: 0, nb: 0 }
      ],
      fallOfWickets: []
    }
  ]
}
Only return valid JSON without markdown or formatting.
"""${text}"""
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  let raw = response.text().trim();

  if (raw.startsWith("```") || raw.includes("```json")) {
    raw = raw.replace(/```json/i, "").replace(/```/, "").trim();
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to parse Gemini JSON:\n", raw);
    throw err;
  }
}

async function updatePlayerStatsFromMatch(match) {
  for (const inning of match.innings) {
    for (const batsman of inning.batsmen || []) {
      if (!batsman.name || batsman.name === "Extras") continue;
      const { name, runs = 0, balls = 0, fours = 0, sixes = 0, outDesc = "" } = batsman;
      const sr = balls ? (runs / balls) * 100 : 0;
      const isNotOut = /not[\s-]?out/i.test(outDesc);

      const existing = await PlayerStats.findOne({ name });
      if (!existing) {
        await sendNewPlayerEmail(name);
      }

      const update = {
        $inc: {
          "batting.matches": 1,
          "batting.runs": runs,
          "batting.balls": balls,
          "batting.fours": fours,
          "batting.sixes": sixes
        }
      };

      if (isNotOut) {
        update.$inc["batting.NOs"] = 1;
      }

      const player = await PlayerStats.findOneAndUpdate(
        { name },
        update,
        { new: true, upsert: true }
      );

      player.batting.strikeRate = player.batting.balls
        ? parseFloat((player.batting.runs / player.batting.balls * 100).toFixed(2))
        : 0;
      await player.save();
    }

    for (const bowler of inning.bowlers || []) {
      const {
        name,
        overs = 0,
        maidens = 0,
        runs = 0,
        wickets = 0,
        dots = 0,
        fours = 0,
        sixes = 0,
        wd = 0,
        nb = 0
      } = bowler;

      const existing = await PlayerStats.findOne({ name });
      if (!existing) {
        await sendNewPlayerEmail(name);
      }

      const player = await PlayerStats.findOneAndUpdate(
        { name },
        {
          $inc: {
            "bowling.matches": 1,
            "bowling.overs": overs,
            "bowling.runs": runs,
            "bowling.wickets": wickets,
            "bowling.maidens": maidens,
            "bowling.dots": dots,
            "bowling.fours": fours,
            "bowling.sixes": sixes,
            "bowling.wd": wd,
            "bowling.nb": nb
          }
        },
        { new: true, upsert: true }
      );

      player.bowling.economy = player.bowling.overs
        ? parseFloat((player.bowling.runs / player.bowling.overs).toFixed(2))
        : 0;
      await player.save();
    }
  }
}


exports.uploadPDF = async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const data = await pdfParse(fileBuffer);
    const extracted = await extractDataWithAI(data.text);

    extracted.innings = extracted.innings.map(inning => ({
      ...inning,
      team: normalizeTeamName(inning.team)
    }));

    extracted.matchInfo.teams = extracted.matchInfo.teams.map(normalizeTeamName);

    const savedMatch = await Match.create(extracted);
    await updatePlayerStatsFromMatch(extracted);
    req.io.emit("newScorecard", savedMatch);
    res.json(savedMatch);
  } catch (err) {
    console.error("❌ AI Upload Error:", err);
    res.status(500).json({ error: "Failed to parse PDF and save data." });
  }
};

exports.getAllMatches = async (req, res) => {
  try {
    const matches = await Match.find().sort({ _id: -1 });
    res.json(matches);
  } catch (err) {
    console.error("❌ Get Matches Error:", err);
    res.status(500).json({ error: "Failed to fetch matches." });
  }
};

exports.validateStumpsReport = async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const data = await pdfParse(fileBuffer);

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `
You are verifying a cricket match PDF.

Based on the text below, answer only "YES" or "NO":
Is this match report created from the STUMPS cricket scoring app?
"""${data.text}"""
`;

    const result = await model.generateContent(prompt);
    const responseText = (await result.response.text()).trim().toUpperCase();

    if (responseText === 'YES') {
      return res.json({ isValid: true });
    } else {
      return res.status(400).json({ isValid: false, error: "Not a STUMPS match report." });
    }
  } catch (err) {
    console.error("❌ STUMPS Check Error:", err);
    res.status(500).json({ error: "Failed to validate PDF." });
  }
};
exports.playerstat = async (req, res) => {
  try {
    const players = await PlayerStats.find().sort({ serial: 1 });
    res.json(players);
  } catch (err) {
    console.error("❌ Failed to fetch player stats:", err);
    res.status(500).json({ error: "Failed to fetch player stats." });
  }
};

// POST /api/playerstats/add
exports.playerstatadd= async (req, res) => {
  try {
    const { name, serial } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Player name is required.' });
    }

    const existingPlayer = await PlayerStats.findOne({ name });
    if (existingPlayer) {
      return res.status(400).json({ message: 'Player already exists.' });
    }

    const newPlayer = new PlayerStats({ name, serial });
    await newPlayer.save();

    res.status(201).json({ message: 'Player added successfully', player: newPlayer });
  } catch (error) {
    console.error('Error adding player:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/match/validate-players
exports.validatePlayerNamesFromPDF = async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const data = await pdfParse(fileBuffer);
    
    // Extract match data using Gemini AI
    const extracted = await extractDataWithAI(data.text);

    // Prepare a list of player names (both batsmen and bowlers)
    const allPlayerNames = new Set();

    for (const inning of extracted.innings || []) {
      for (const batsman of inning.batsmen || []) {
        if (batsman.name && batsman.name !== "Extras") {
          allPlayerNames.add(batsman.name.trim());
        }
      }

      for (const bowler of inning.bowlers || []) {
        if (bowler.name) {
          allPlayerNames.add(bowler.name.trim());
        }
      }
    }

    const allNames = Array.from(allPlayerNames);

    // Query Gemini AI to validate if players exist in PlayerStats
    const playerValidationPrompt = `
    Validate the following player names. For each player, answer with "YES" if the player exists in the database, otherwise answer "NO":
    ${allNames.join(", ")}
    `;

    const validationResult = await genAI.getGenerativeModel().generateContent({ model: "gemini-2.0-flash" });
    const validationResponse = await validationResult.response.text();

    // Return the validation results to the frontend
    res.json({ validationResponse });
  } catch (error) {
    console.error("❌ Error validating player names:", error);
    res.status(500).json({ message: "Failed to validate player names" });
  }
};

exports.extractPlayerNames = async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const data = await pdfParse(fileBuffer);

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });

    const prompt = `
You are analyzing a cricket match report from the STUMPS app.
Your task is to extract only the **player names** who played in the match from the following report.

Rules:
- Return only the names in a JSON array format like ["Player One", "Player Two", ...].
- Do not return anything else like team names or commentary.
- Avoid repeating names.

Match report text:
"""${data.text}"""
    `;

    const result = await model.generateContent(prompt);
    const textOutput = (await result.response.text()).trim();

    // Parse the output assuming it's a JSON array string
    const playerNames = JSON.parse(textOutput);

    res.json({ playerNames });
  } catch (err) {
    console.error("❌ Error extracting player names via Gemini:", err);
    res.status(500).json({ error: "Failed to extract player names." });
  }
};

exports.validatePlayerNames = async (req, res) => {
  try {
    const { playerNames } = req.body;
    
    if (!playerNames || playerNames.length === 0) {
      return res.status(400).json({ error: "No player names provided." });
    }

    // Query the database to check for missing players
    const existingPlayers = await PlayerStats.find({ name: { $in: playerNames } });

    const existingPlayerNames = new Set(existingPlayers.map(player => player.name));
    const missingPlayers = playerNames.filter(name => !existingPlayerNames.has(name));

    res.json({ missingPlayers });
  } catch (err) {
    console.error("❌ Error validating player names:", err);
    res.status(500).json({ error: "Failed to validate player names." });
  }
};

exports.updatePlayerNames = async (req, res) => {
  try {
    const { oldNames, newNames } = req.body;
    
    if (!oldNames || !newNames || oldNames.length !== newNames.length) {
      return res.status(400).json({ error: "Invalid name update data." });
    }

    // Update player names in the database
    for (let i = 0; i < oldNames.length; i++) {
      await PlayerStats.updateOne({ name: oldNames[i] }, { $set: { name: newNames[i] } });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating player names:", err);
    res.status(500).json({ error: "Failed to update player names." });
  }
};






