const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Match = require("../models/ScoreCard");
const PlayerStats = require("../models/PlayerStats");
const Image = require("../models/Image");
const Team = require("../models/Team");
const { sendNewPlayerEmail } = require("./mailer");
const { getModelListWithDefaultFirst, moveToNextModel, fetchModels } = require('./modelSelector');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeTeamName(name) {
  if (!name) return "";

  return name
    .replace(/^TEAM(?=\S)/i, "TEAM ")        // Add space after "TEAM" if stuck
    .replace(/([a-z])([A-Z])/g, "$1 $2")     // Space between lowercase-uppercase
    .replace(/\d+/g, "")                     // Remove all digits
    .replace(/\s+/g, " ")                    // Normalize extra spaces
    .trim();
}

function getWinnerFromResult(resultText) {
  if (!resultText) return null;
  const fixedText = resultText.replace(/(won)/i, ' $1');
  console.log("🛠️ Fixed Text:", fixedText); 
  const teamName = fixedText.split(' won')[0].trim(); 
  console.log("🔍 Extracted Team Name:", teamName);
  return normalizeTeamName(teamName);
}

async function extractDataWithAI(text) {
  const availableModels = await getModelListWithDefaultFirst();
  let currentIndex = 0;
  let retries = availableModels.length;

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
- **For 'outDesc'**, follow these rules:
  - Ensure standard cricket dismissal prefixes like **"b"**, **"c"**, **"lbw"**, **"Run Out"**, **"st"**, and **"Retired Hurt"** are **separated from player names** with a space.
  - Fix common errors like **"bCFO"** → "b CFO" or **"RetiredHurt"** → "Retired Hurt".
  - If both bowler and fielder are mentioned (e.g., "c Aadhavan Sridharan b CFO"), match their names **exactly** as extracted elsewhere, including spacing and capitalization.
  - If player names are joined with dismissal terms, **insert proper spacing** to separate them.
  - Final outDesc value must be a **natural, readable cricket dismissal line** with correct spelling, spacing, and capitalization.
  - If you find minor mistakes in outDesc, such as missing spaces or wrong letter cases, **correct them based on the batsman or bowler names**.
- **Sort the matchInfo.teams array in alphabetical order**, and ensure the innings entries are aligned to the correct team name accordingly.
- When sorting team names, **treat them case-insensitively** and sort by standard dictionary order (e.g., "TEAM JAYANTH" before "TEAM SHRIDHAR").
- **Format the matchInfo.date field strictly in DDMonYYYY format (e.g., 19Apr2025)**. Remove any time information, commas, or spacing inconsistencies.
- Return only valid JSON, no markdown formatting.
"""${text}"""
  `;

  while (retries > 0) {
    const modelName = availableModels[currentIndex];
    console.log(`⚙️ Trying model: ${modelName}`);

    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let raw = response.text().trim();

      if (raw.startsWith("```") || raw.includes("```json")) {
        raw = raw.replace(/```json/i, "").replace(/```/, "").trim();
      }

      return JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Gemini Error on model ${modelName}:`, err.message);

      const isRecoverable = (
        err.message.includes('503') ||
        err.message.includes('overloaded') ||
        err.message.includes('not found') ||
        err.message.includes('404')
      );

      if (isRecoverable) {
        console.warn(`⚠️ Model ${modelName} failed. Trying next model...`);
        currentIndex = moveToNextModel(currentIndex, availableModels);
        retries--;
      } else {
        throw err; // unrecoverable error — stop immediately
      }
    }
  }

  throw new Error("❌ All Gemini models failed after retries.");
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
    const [pdfTeamA, pdfTeamB] = extracted.matchInfo.teams.map(normalizeTeamName);

    let team1 = await Team.findOne({ teamId: 'team1' });
    let team2 = await Team.findOne({ teamId: 'team2' });
    const dbTeam1Name = normalizeTeamName(team1?.teamName || '');
    const dbTeam2Name = normalizeTeamName(team2?.teamName || '');
    if (!team1 && !team2) {
      team1 = await new Team({
        teamId: 'team1',
        teamName: pdfTeamA,
        captain: "",
        coreTeam: [],
        points: 0,
        score: Array(15).fill('-'),
      }).save();
      team2 = await new Team({
        teamId: 'team2',
        teamName: pdfTeamB,
        captain: "",
        coreTeam: [],
        points: 0,
        score: Array(15).fill('-'),
      }).save();
    } else {
      const pdfTeams = [pdfTeamA, pdfTeamB];
      if (!pdfTeams.includes(dbTeam1Name)) {
        const newNameForTeam1 = pdfTeams.find(name => name !== dbTeam2Name);
        if (newNameForTeam1) {
          team1.teamName = newNameForTeam1;
          await team1.save();
        }
      }
      if (!pdfTeams.includes(dbTeam2Name)) {
        const newNameForTeam2 = pdfTeams.find(name => name !== team1.teamName);
        if (newNameForTeam2) {
          team2.teamName = newNameForTeam2;
          await team2.save();
        }
      }
    }
    const resultText = extracted.matchInfo.result || "";
    const winnerName = getWinnerFromResult(resultText);
    const loserName = [pdfTeamA, pdfTeamB].find(t => t !== winnerName);
    const winner = [team1, team2].find(t => normalizeTeamName(t.teamName) === winnerName);
    const loser = [team1, team2].find(t => normalizeTeamName(t.teamName) === loserName);
    if (winner && loser) {
      if (winner.points === 0 && loser.points === 0) {
        const start = new Date();
        const startDay = new Date(start.getTime() + (5 * 60 + 30) * 60000);
        winner.startDate = startDay;
        loser.startDate = startDay;
      }
      winner.points += 1;
      winner.score.push("W");
      loser.score.push("L");
      if (winner.score.length > 15) winner.score.shift();
      if (loser.score.length > 15) loser.score.shift();
      winner.isRevert = true;
      loser.isRevert = false;
      await winner.save();
      await loser.save();
      console.log("✅ Points and scores updated");
    }

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

    const availableModels = await getModelListWithDefaultFirst();
    let currentIndex = 0;
    let retries = availableModels.length;

    const prompt = `
You are verifying a cricket match PDF.

Based on the text below, answer only "YES" or "NO":
Is this match report created from the STUMPS cricket scoring app?
"""${data.text}"""
    `;

    while (retries > 0) {
      const modelName = availableModels[currentIndex];
      console.log(`🔍 Validating STUMPS report using model: ${modelName}`);

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const responseText = (await result.response.text()).trim().toUpperCase();

        if (responseText === 'YES') {
          return res.json({ isValid: true });
        } else {
          return res.status(400).json({ isValid: false, error: "Not a STUMPS match report." });
        }

      } catch (err) {
        console.error(`❌ Gemini error on model ${modelName}:`, err.message);

        const isRecoverable =
          err.message.includes('503') ||
          err.message.includes('overloaded') ||
          err.message.includes('404') ||
          err.message.toLowerCase().includes('not found');

        if (isRecoverable) {
          console.warn(`⚠️ Model ${modelName} failed. Trying next model...`);
          currentIndex = moveToNextModel(currentIndex, availableModels);
          retries--;
        } else {
          return res.status(500).json({ error: "Failed to validate PDF due to AI error." });
        }
      }
    }

    return res.status(500).json({ error: "All Gemini models failed to validate the report." });

  } catch (err) {
    console.error("❌ STUMPS Check Fatal Error:", err.message);
    return res.status(500).json({ error: "Unexpected error validating PDF." });
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

    const availableModels = await getModelListWithDefaultFirst();
    let currentIndex = 0;
    let retries = availableModels.length;

    const prompt = `
You are analyzing a cricket match report from the STUMPS app.

Your task is to extract the full list of **player names** who participated in the match.

### Rules:
- Return a **JSON array** of names like: ["Player One", "Player Two", ...]
- Include batters, bowlers, fielders, and any player mentioned in the scorecard, dismissal lines (like "c Ram b Gucci"), or bowling/partnership summaries.
- Pay attention to cricket notation (e.g., "c Ram b Gucci") — extract both "Ram" and "Gucci" as valid players.
- Fix minor errors such as:
  - "c Ram b Gucci" → should be "Ram" and "Gucci"
  - Remove stray trailing characters like "b", "lbw", "runout", etc.
  - Restore spacing in merged names like "KarthikPonting" → "Karthik Ponting"
- Use **context clues** to correct or infer proper name formatting.
- Preserve correct **capitalization** and **spacing** as much as possible.
- Avoid duplicate names and remove team names or metadata.

Match report:
"""${data.text}"""
`;

    while (retries > 0) {
      const modelName = availableModels[currentIndex];
      console.log(`🔍 Extracting player names using model: ${modelName}`);

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        let textOutput = (await result.response.text()).trim();

        // Clean markdown formatting if present
        textOutput = textOutput.replace(/```json|```/gi, '').trim();

        const playerNames = JSON.parse(textOutput);
        return res.json({ playerNames });

      } catch (err) {
        console.error(`❌ Gemini error on model ${modelName}:`, err.message);

        const isRecoverable =
          err.message.includes('503') ||
          err.message.includes('overloaded') ||
          err.message.includes('404') ||
          err.message.toLowerCase().includes('not found');

        if (isRecoverable) {
          console.warn(`⚠️ Model ${modelName} failed. Trying next model...`);
          currentIndex = moveToNextModel(currentIndex, availableModels);
          retries--;
        } else {
          return res.status(500).json({ error: "Failed to extract player names." });
        }
      }
    }

    return res.status(500).json({ error: "All Gemini models failed to extract player names." });

  } catch (err) {
    console.error("❌ PDF Parse or system error:", err.message);
    return res.status(500).json({ error: "Unexpected error extracting player names." });
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
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ message: "Missing or invalid 'updates' parameter." });
    }

    for (const { original, updated } of updates) {
      if (!original || !updated) {
        return res.status(400).json({ message: "Both 'original' and 'updated' names must be provided." });
      }

      // Update PlayerStats
      const player = await PlayerStats.findOneAndUpdate(
        { name: original },
        { name: updated },
        { new: true }
      );

      if (!player) {
        return res.status(404).json({ message: `Player with name "${original}" not found in PlayerStats.` });
      }
      await Image.updateMany(
          { "history.winner": original },
          { $set: { "history.$[elem].winner": updated } },
          { arrayFilters: [{ "elem.winner": original }] }
        );

      // Update ScoreCard entries
      const scorecards = await Match.find({
        $or: [
          { 'innings.batsmen.name': original },
          { 'innings.bowlers.name': original },
          { 'innings.batsmen.outDesc': new RegExp(original, 'i') },
          { 'innings.fallOfWickets': { $elemMatch: { $regex: original, $options: 'i' } } }
        ]
      });

      for (const match of scorecards) {
        let updatedFlag = false;

        for (const inning of match.innings) {
          // Update batsmen names
          for (const batsman of inning.batsmen) {
            if (batsman.name === original) {
              batsman.name = updated;
              updatedFlag = true;
            }
            if (batsman.outDesc && batsman.outDesc.includes(original)) {
              batsman.outDesc = batsman.outDesc.replace(new RegExp(original, 'g'), updated);
              updatedFlag = true;
            }
          }

          // Update bowlers names
          for (const bowler of inning.bowlers) {
            if (bowler.name === original) {
              bowler.name = updated;
              updatedFlag = true;
            }
          }

          // Update fallOfWickets
          if (Array.isArray(inning.fallOfWickets)) {
            inning.fallOfWickets = inning.fallOfWickets.map(desc =>
              desc.includes(original) ? desc.replace(new RegExp(original, 'g'), updated) : desc
            );
            updatedFlag = true;
          }
        }

        if (updatedFlag) {
          await match.save();
        }
      }
    }

    return res.status(200).json({ success: true, message: "Player names updated successfully in PlayerStats and ScoreCard!" });

  } catch (err) {
    console.error("Error updating player names:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.allscorecard = async (req, res) => {
  try {
    const scorecards = await Match.find();
    res.status(200).json(scorecards);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch scorecards", error });
  }
};

exports.revertLastMatch = async (req, res) => {
  try {
    const lastMatch = await Match.findOne().sort({ createdAt: -1 });
    if (!lastMatch) {
      return res.status(404).json({ error: "No matches found to revert." });
    }

    const { innings, matchInfo } = lastMatch;

    // Revert player stats
    for (const inning of innings) {
      // Batting
      for (const batsman of inning.batsmen || []) {
        if (!batsman.name || batsman.name === "Extras") continue;
        const { name, runs = 0, balls = 0, fours = 0, sixes = 0, outDesc = "" } = batsman;
        const isNotOut = /not[\s-]?out/i.test(outDesc);

        const player = await PlayerStats.findOne({ name });
        if (player) {
          const update = {
            $inc: {
              "batting.matches": -1,
              "batting.runs": -runs,
              "batting.balls": -balls,
              "batting.fours": -fours,
              "batting.sixes": -sixes
            }
          };
          if (isNotOut) update.$inc["batting.NOs"] = -1;

          await PlayerStats.findOneAndUpdate({ name }, update);
          player.batting.strikeRate = player.batting.balls
            ? parseFloat((player.batting.runs / player.batting.balls * 100).toFixed(2))
            : 0;
          await player.save();
        }
      }

      // Bowling
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

        const player = await PlayerStats.findOne({ name });
        if (player) {
          await PlayerStats.findOneAndUpdate(
            { name },
            {
              $inc: {
                "bowling.matches": -1,
                "bowling.overs": -overs,
                "bowling.runs": -runs,
                "bowling.wickets": -wickets,
                "bowling.maidens": -maidens,
                "bowling.dots": -dots,
                "bowling.fours": -fours,
                "bowling.sixes": -sixes,
                "bowling.wd": -wd,
                "bowling.nb": -nb
              }
            }
          );

          player.bowling.economy = player.bowling.overs
            ? parseFloat((player.bowling.runs / player.bowling.overs).toFixed(2))
            : 0;
          await player.save();
        }
      }
    }
    console.log("✅ Reverted score");

    // Revert team points/scores
    const [team1, team2] = await Promise.all([
      Team.findOne({ teamId: 'team1' }),
      Team.findOne({ teamId: 'team2' })
    ]);
    
    // Determine winner and loser using isRevert
    let lastWinner, lastLoser;
    if (team1?.isRevert === true && team2?.isRevert === false) {
      lastWinner = team1;
      lastLoser = team2;
    } else if (team2?.isRevert === true && team1?.isRevert === false) {
      lastWinner = team2;
      lastLoser = team1;
    } else {
      return res.status(400).json({ error: "Cannot determine winner and loser from isRevert flags." });
    }
    
    // Revert team points and score
    if (lastWinner.score.length && lastLoser.score.length) {
      if (lastWinner.score.at(-1) === "W") lastWinner.score.pop();
      if (lastLoser.score.at(-1) === "L") lastLoser.score.pop();
    
      lastWinner.points = Math.max(0, lastWinner.points - 1);
      lastWinner.isRevert = false;
      lastLoser.isRevert = false;
    
      await lastWinner.save();
      await lastLoser.save();
      console.log("✅ Reverted team points");
    }

    // Delete match
    await Match.findByIdAndDelete(lastMatch._id);
    console.log("✅ Last match removed");

    res.json({ message: "Last match and stats successfully reverted." });
  } catch (err) {
    console.error("❌ Revert Last Match Error:", err);
    res.status(500).json({ error: "Failed to revert last match and stats." });
  }
};






