const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Match = require("../models/ScoreCard");
const PlayerStats = require("../models/PlayerStats");
const { sendNewPlayerEmail } = require("./mailer");
const { getCurrentModel, moveToNextModel, fetchModels } = require('./modelSelector');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeTeamName(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\d+/g, "").trim();
}

async function extractDataWithAI(text) {
  await fetchModels(); // make sure models are fetched first

  let modelName = await getCurrentModel();
  let model = genAI.getGenerativeModel({ model: modelName });

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
Important:
- **Extract and preserve names exactly as written in the text, including spaces, capitalization, and any middle names.**
- **If any batsman or bowler names appear to be merged without spaces**, intelligently detect common first names and surnames, and restore spaces between them. For example, if "AadhavanSridharan" is detected, split it into "Aadhavan Sridharan".
- **Do not merge initials with names**: If there are initials in the names (e.g., "Julie B Madhu"), preserve the space between the initials and the last name.
- **For 'outDesc'**, when mentioning players, ensure the player names are **exactly as extracted** (including spaces and capitalization). 
- If a name appears in a dismissal description (e.g., run-out, caught), match the **full name** carefully and preserve exact spacing and capitalization.
- If you find minor mistakes in outDesc, such as missing spaces or wrong letter cases, **correct them based on the batsman or bowler names**.
- Return only valid JSON, no markdown formatting.
"""${text}"""
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let raw = response.text().trim();

    if (raw.startsWith("```") || raw.includes("```json")) {
      raw = raw.replace(/```json/i, "").replace(/```/, "").trim();
    }

    return JSON.parse(raw);
  } catch (err) {
    console.error(`❌ Gemini Error on model ${modelName}:`, err.message);

    if (
      err.message.includes('overloaded') ||
      err.message.includes('503') ||
      err.message.includes('404') ||
      err.message.toLowerCase().includes('not found')
    ) {
      console.warn(`⚠️ Model ${modelName} failed (overload/deprecated/not found). Switching to next model...`);
      moveToNextModel(); // move to next model
      return extractDataWithAI(text); // retry recursively
    } else {
      throw err; // other errors are thrown up
    }
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

    // Ensure models are fetched first
    await fetchModels();

    let modelName = await getCurrentModel();
    const model = genAI.getGenerativeModel({ model: modelName });

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
    console.error("❌ STUMPS Check Error:", err.message);

    if (
      err.message.includes('503') || 
      err.message.includes('overloaded') || 
      err.message.includes('404') || 
      err.message.includes('not found')
    ) {
      console.warn(`⚠️ Model issue detected (${err.message}), switching to next model...`);
      moveToNextModel(); // Move to the next model
      return exports.validateStumpsReport(req, res); // Retry
    } else {
      res.status(500).json({ error: "Failed to validate PDF." });
    }
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
exports.playerstatadd = async (req, res) => {
  try {
    let players = req.body;

    // Ensure players is always an array
    if (!Array.isArray(players)) {
      players = [players];
    }

    const addedPlayers = [];
    const skippedPlayers = [];

    for (const player of players) {
      const { name, serial } = player;

      if (!name) {
        skippedPlayers.push({ player, reason: "Missing name" });
        continue;
      }

      const existingPlayer = await PlayerStats.findOne({ name });
      if (existingPlayer) {
        skippedPlayers.push({ player, reason: "Already exists" });
        continue;
      }

      const newPlayer = new PlayerStats({ name, serial });
      await newPlayer.save();
      addedPlayers.push(newPlayer);
    }

    res.status(201).json({
      message: "Player addition complete",
      added: addedPlayers,
      skipped: skippedPlayers,
    });
  } catch (error) {
    console.error("Error adding players:", error);
    res.status(500).json({ message: "Internal server error" });
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

    // Ensure models are fetched first
    await fetchModels();

    let modelName = await getCurrentModel();
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `
You are analyzing a cricket match report from the STUMPS app.
Your task is to extract only the **player names** who played in the match from the following report.

Important rules:
- Return the names in a JSON array format like ["Player One", "Player Two", ...].
- **Restore missing spaces** if names appear merged together, based on typical cricket naming patterns and styles seen elsewhere in the report.
- Preserve the **original spaces** and **capitalization** of the names exactly as written when correct.
- Avoid repeating names.
- Do not return anything else like team names, commentary, or other metadata.

Match report text:
"""${data.text}"""
    `;

    const result = await model.generateContent(prompt);
    let textOutput = (await result.response.text()).trim();

    // Remove markdown formatting like ```json ... ```
    textOutput = textOutput.replace(/```json|```/g, '').trim();

    // Attempt to parse
    const playerNames = JSON.parse(textOutput);

    res.json({ playerNames });
  } catch (err) {
    console.error("❌ Error extracting player names via Gemini:", err.message);

    if (
      err.message.includes('503') || // overloaded
      err.message.includes('overloaded') ||
      err.message.includes('404') ||  // model not found
      err.message.includes('not found')
    ) {
      console.warn(`⚠️ Model issue detected (${err.message}), switching to next model...`);
      moveToNextModel(); // Move to next model
      return exports.extractPlayerNames(req, res); // Retry
    } else {
      res.status(500).json({ error: "Failed to extract player names." });
    }
  }
};


exports.validatePlayerNames = async (req, res) => {
  try {
    const { playerNames } = req.body;

    if (!playerNames || playerNames.length === 0) {
      return res.status(400).json({ error: "No player names provided." });
    }

    // Get all players for suggesting replacements
    const allPlayers = await PlayerStats.find({}, 'name serial').sort({ serial: 1 });

    // Check which player names exist in the DB
    const existingPlayers = await PlayerStats.find({ name: { $in: playerNames } });
    const existingPlayerNames = new Set(existingPlayers.map(player => player.name));

    const missingPlayers = playerNames.filter(name => !existingPlayerNames.has(name));

    // Prepare the response
    res.json({
      missingPlayers,             // List of extracted names not in DB
      allExistingPlayers: allPlayers // List of all DB names for dropdown
    });
  } catch (err) {
    console.error("❌ Error validating player names:", err);
    res.status(500).json({ error: "Failed to validate player names." });
  }
};

// Update player names in the database
exports.updatePlayerNames = async (req, res) => {
  try {
    // Get the 'updates' parameter from the request body
    const { updates } = req.body;

    // Validate if 'updates' is provided and is an array
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ message: "Missing or invalid 'updates' parameter." });
    }

    // Loop through each update object and update the player names
    for (const { original, updated } of updates) {
      if (!original || !updated) {
        return res.status(400).json({ message: "Both 'original' and 'updated' names must be provided." });
      }

      // Find the player with the 'original' name and update to the 'updated' name
      const player = await PlayerStats.findOneAndUpdate(
        { name: original },          // Find player by original name
        { name: updated },           // Update with the new name
        { new: true }                // Return the updated player document
      );

      // If the player wasn't found, return an error
      if (!player) {
        return res.status(404).json({ message: `Player with name "${original}" not found.` });
      }
    }

    // Respond with success if all updates were successful
    return res.status(200).json({ success: true, message: "Player names updated successfully!" });

  } catch (err) {
    console.error("Error updating player names:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};







