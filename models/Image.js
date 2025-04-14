const mongoose = require("mongoose");
const ImageSchema = new mongoose.Schema({
    image: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    history: [
        {
            winner: String,
            date: String,
            position: String,
            team: String
        }
    ]
});
module.exports = mongoose.model("Image", ImageSchema);