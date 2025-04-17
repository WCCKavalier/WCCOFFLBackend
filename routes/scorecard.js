const express = require("express");
const multer = require("multer");
const { uploadPDF, getAllMatches,validateStumpsReport } = require("../utils/pdfParser");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() }); // Store in memory only

router.post("/", upload.single("pdf"), uploadPDF);   // Upload + AI parse
router.get("/", getAllMatches);                      // Fetch all parsed matches
router.post('/validateStumpsReport', upload.single('pdf'), validateStumpsReport);

module.exports = router;
