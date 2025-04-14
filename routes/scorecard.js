const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const parseMatchReport = require('../utils/pdfParser');
const Scorecard = require('../models/ScoreCard');

const storage = multer.memoryStorage();
const upload = multer({ storage });

// 📤 Upload and parse PDF
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      const tempPath = path.join(__dirname, `../temp_${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, req.file.buffer);
  
      const scorecard = await parseMatchReport(tempPath);
      fs.unlinkSync(tempPath);
  
      const newScorecard = new Scorecard(scorecard);
      await newScorecard.save();
  
      // Emit real-time event to clients via Socket.IO
      req.io.emit('newScorecard', newScorecard);
  
      res.status(200).json({ message: 'Scorecard uploaded and saved!' });
    } catch (err) {
      console.error('❌ Error parsing PDF:', err);
      res.status(500).json({ error: err.message });
    }
  });

// 📥 Fetch all scorecards
router.get('/', async (req, res) => {
  try {
    const scorecards = await Scorecard.find().sort({ date: -1 });
    res.json(scorecards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
