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

dotenv.config();
connectDB();

const job = require('./cron.js');
job.start();
const allowedOrigins = [
  "http://localhost:3000", // ✅ Local React
  "https://wcc-kavaliers.vercel.app" // ✅ Replace with your actual Vercel frontend URL
];
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
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
app.use((req, res, next) => {
  req.io = io;
  next();
});
app.use("/api/auth", authRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/team", teamRoutes);
const messageRoutes = require("./routes/messages");
app.use("/api/messages", messageRoutes(io));

// Handle socket.io connections
io.on("connection", (socket) => {
  console.log("🔌 A user connected");

  socket.on("sendMessage", async (data) => {
    try {
      const { username, message } = data;
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
