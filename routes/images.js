const express = require("express");
const multer = require("multer");
const Image = require("../models/Image");

const router = express.Router();

// Multer storage configuration
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload image and append new data
router.post("/upload", upload.single("image"), async (req, res) => {
    try {
        const { winner, date, position, team } = req.body;

        // Retrieve the existing document
        let existingImage = await Image.findOne();

        if (existingImage) {
            // Append new data
            existingImage.history.unshift({ winner, date, position, team });

            // Keep only the last 30 entries
            if (existingImage.history.length > 30) {
                existingImage.history.pop();
            }

            // Replace the image
            existingImage.image = req.file.buffer;
            existingImage.contentType = req.file.mimetype;

            await existingImage.save();
        } else {
            // If no image exists, create a new document
            existingImage = new Image({
                image: req.file.buffer,
                contentType: req.file.mimetype,
                history: [{ winner, date, position, team }]
            });
            await existingImage.save();
        }

        res.json({ message: "Image uploaded successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

// Fetch the latest image and data
router.get("/get-image", async (req, res) => {
    try {
        const imageDoc = await Image.findOne();
        if (!imageDoc) return res.status(404).json({ message: "No image found" });

        res.json({
            image: `data:${imageDoc.contentType};base64,${imageDoc.image.toString("base64")}`,
            history: imageDoc.history
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/filter", async (req, res) => {
    try {
        const filters = req.body;
        const image = await Image.findOne({});
        if (!image) return res.json({ history: [] });

        let filteredHistory = image.history;

        Object.entries(filters).forEach(([key, value]) => {
            if (key === "date") {
                if (value.year) {
                    filteredHistory = filteredHistory.filter((entry) => entry.date.startsWith(value.year));
                }
                if (value.month) {
                    filteredHistory = filteredHistory.filter((entry) => entry.date.split("-")[1] === value.month);
                }
                if (value.day) {
                    filteredHistory = filteredHistory.filter((entry) => entry.date.split("-")[2] === value.day);
                }
            } else {
                filteredHistory = filteredHistory.filter((entry) => entry[key] === value);
            }
        });

        res.json({ history: filteredHistory });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to filter history" });
    }
});

router.delete("/deleteall", async (req, res) => {
    try {
        await Image.deleteMany({});
        res.status(200).json({ message: "All data deleted successfully." });
    } catch (error) {
        res.status(500).json({ message: "Error deleting data", error });
    }
});

module.exports = router;
