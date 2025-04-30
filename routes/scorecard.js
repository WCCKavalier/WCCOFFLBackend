const express = require("express");
const multer = require("multer");
const { uploadPDF, getAllMatches,validateStumpsReport,playerstat,playerstatadd,validatePlayerNamesFromPDF,extractPlayerNames,validatePlayerNames,updatePlayerNames,allscorecard } = require("../utils/pdfParser");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() }); // Store in memory only

router.post("/", upload.single("pdf"), uploadPDF);   // Upload + AI parse
router.get("/", getAllMatches);                      // Fetch all parsed matches
router.post('/validateStumpsReport', upload.single('pdf'), validateStumpsReport);
router.get("/playerstat", playerstat);  
router.post("/playerstatadd", playerstatadd);  
router.post("/validate-player-names", upload.single("pdf"), validatePlayerNamesFromPDF);
router.post("/extractPlayerNames", upload.single("pdf"), extractPlayerNames);     
router.post("/validatePlayerNames", validatePlayerNames);                         
router.post("/updatePlayerNames", updatePlayerNames);
router.get("/allscorecard", allscorecard);

module.exports = router;
