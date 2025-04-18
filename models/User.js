const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    username: String,
    email: String,
    password: String,
    admin: { type: String, default: "N" }
});

module.exports = mongoose.model("User", UserSchema);