const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Match = require("../models/ScoreCard");
const PlayerStats = require("../models/PlayerStats");

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
      const isNotOut = /notout/i.test(outDesc);

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
