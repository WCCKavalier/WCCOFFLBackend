const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { createServer } = require("http");
const { Server } = require("socket.io");
const connectDB = require("./config/db.js");
const Team = require('./models/Team.js')
const authRoutes = require('./routes/users.js')
const Message = require("./models/Message.js");
const imageRoutes = require("./routes/images.js");
const teamRoutes = require("./routes/teamRoutes.js");
const scorecardRoutes = require('./routes/scorecard.js');
const Activity = require('./models/Activity.js');

dotenv.config();
connectDB();

// const job = require('./cron.js');
// job.start();
const allowedOrigins = [
  "http://localhost:3000",
  "https://wcc-kavaliers.vercel.app",
];
function corsOriginCheck(origin, callback) {
  const cleanOrigin = origin?.replace(/\/$/, ""); // remove trailing slash

  const ipBasedOrigin = /^https?:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(cleanOrigin);

  if (
    !origin || // allow Postman etc.
    allowedOrigins.includes(cleanOrigin) || // allow localhost and vercel
    ipBasedOrigin // allow http://<any-ip>:<port>
  ) {
    callback(null, true);
  } else {
    callback(new Error("Not allowed by CORS"));
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOriginCheck,
    methods: ["GET", "POST","PUT","DELETE"],
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST","PUT","DELETE"],
  credentials: true
}));
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    const now = new Date();
    const adjustedTime = new Date(now.getTime() + (5 * 60 + 30) * 60000);
    await Activity.updateOne(
      { name: 'activityStatus' },
      { lastActive: adjustedTime, active: true },
      { upsert: true }
    );
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.ip;

    // If NOT from Better Uptime Bot, log in console
    if (!userAgent.includes('Better Uptime Bot')) {
      console.log(`🚨 Suspicious Ping Detected! 
        URL: ${req.originalUrl}
        Method: ${req.method}
        User-Agent: ${userAgent}
        IP: ${ip}
        Time: ${adjustedTime.toISOString()}
      `);
    }
  } catch (err) {
    console.error('⚠️ Failed to update activity log:', err.message);
  }
  next();
});
app.use((req, res, next) => {
  req.io = io;
  next();
});
app.get("/ping", (req, res) => {
  res.send("pong");
});
app.use("/api/auth", authRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/uploadScorecard", scorecardRoutes);
const messageRoutes = require("./routes/messages");
app.use("/api/messages", messageRoutes(io));

// Handle socket.io connections
io.on("connection", (socket) => {
  console.log("🔌 A user connected");
  const now = new Date();
  const adjustedTime = new Date(now.getTime() + (5 * 60 + 30) * 60000);
  Activity.updateOne(
    { name: 'activityStatus' },
    { lastActive: adjustedTime, active: true },
    { upsert: true }
  ).catch(err => console.error('Socket connect activity error:', err.message));

  socket.on("sendMessage", async (data) => {
    try {
      const { username, message } = data;
      const now = new Date();
      const adjustedTime = new Date(now.getTime() + (5 * 60 + 30) * 60000);
      Activity.updateOne(
        { name: 'activityStatus' },
        { lastActive: adjustedTime, active: true },
        { upsert: true }
      ).catch((err) => console.error('Activity update failed:', err.message));
      const newMessage = new Message({ username, message });
      await newMessage.save();
      io.emit("receiveMessage", newMessage);
    } catch (err) {
      console.error("Error in sendMessage:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ A user disconnected");
  });
});

app.get("/api/teams", async (req, res) => {
  try {
      let teams = await Team.find({ teamId: { $in: ["team1", "team2"] } });

      // Create default objects if teams don't exist in DB
      const defaultTeams = {
          team1: { teamId: "team1", teamName: "", captain: "", coreTeam: [], points: 0, score: Array(15).fill('-'), prevSeries: []},
          team2: { teamId: "team2", teamName: "", captain: "", coreTeam: [], points: 0, score: Array(15).fill('-'), prevSeries: []}
      };

      teams.forEach(team => {
          defaultTeams[team.teamId] = team;
      });

      res.json(defaultTeams);
  } catch (error) {
      res.status(500).json({ error: "Server error" });
  }
});


app.post("/api/team", async (req, res) => {
    const { teamId, teamName, captain, coreTeam } = req.body;
  
    try {
      let existingTeam = await Team.findOne({ teamId });
  
      if (existingTeam) {
        existingTeam.teamName = teamName;
        existingTeam.captain = captain;
        existingTeam.coreTeam = coreTeam;
      } else {
        existingTeam = new Team({
          teamId,
          teamName,
          captain,
          coreTeam,
          points: 0,
          score: Array(15).fill('-'), 
          prevSeries: [],
        });
      }
  
      await existingTeam.save();
      return res.json({ message: `Team ${teamId} saved successfully!` });
    } catch (error) {
      console.error("Error updating/saving team:", error);
      res.status(500).json({ error: "Database error" });
    }
  });
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
