const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");
require("dotenv").config(); // Ensure dotenv is loaded
const router = express.Router();
const verificationCodes = {};
const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Register Route
router.post("/register", async (req, res) => {
    const { username, email, password, code } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already registered" });

    const record = verificationCodes[email];
    if (!record || record.code !== code || Date.now() > record.expires) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword, admin: "N" });
    await user.save();

    delete verificationCodes[email]; // Clean up after successful registration

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Welcome to WCC-The Kavaliers Den",
        text: "Your account has now been registered"
    };
    try {
        await transporter.sendMail(mailOptions);
    } catch (emailError) {
        console.error("Error sending email:", emailError);
    }

    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.status(201).json({ message: "User registered successfully", token, user: { username: user.username, admin: user.admin } });
});

// Login Route
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({ token, user: { username: user.username, admin: user.admin } });
});
const authenticateToken = (req, res, next) => {
    const token = req.header("Authorization")?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Access Denied" });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ message: "Invalid Token" });
    }
};

router.get("/user", authenticateToken, async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ username: user.username, admin: user.admin });
});

router.put("/update-admin", async (req, res) => {
    try {
        const { email, adminStatus } = req.body;
        
        if (!email || !adminStatus) {
            return res.status(400).json({ message: "Email and adminStatus are required" });
        }
        
        if (!["N", "Y"].includes(adminStatus)) {
            return res.status(400).json({ message: "Invalid adminStatus. Use 'N' or 'Y'" });
        }
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        
        user.admin = adminStatus;
        await user.save();

        res.status(200).json({ message: "User admin status updated successfully", user });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error });
    }
});

router.post("/send-registration-code", async (req, res) => {
    const { email } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "Email already registered" });

    const verificationCode = crypto.randomInt(100000, 999999).toString();
    verificationCodes[email] = { code: verificationCode, expires: Date.now() + 10 * 60 * 1000 };

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Registration Verification Code",
        text: `Your registration verification code is: ${verificationCode}`
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ message: "Error sending email" });
        res.json({ message: "Verification code sent to email" });
    });
});

// Forgot Password - Send Code
router.post("/forgot-password", async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ message: "User not found" });

    // Generate a 6-digit verification code
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    verificationCodes[email] = { code: verificationCode, expires: Date.now() + 10 * 60 * 1000 }; // 10-minute expiry

    // Send email with verification code
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Password Reset Code",
        text: `Your password reset code is: ${verificationCode}`
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ message: "Error sending email" });
        res.json({ message: "Verification code sent to email" });
    });
});

// Verify Code & Reset Password
router.post("/reset-password", async (req, res) => {
    const { email, code, newPassword } = req.body;

    const record = verificationCodes[email];

    if (!record || record.code !== code || Date.now() > record.expires) {
        return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user password
    const user = await User.findOneAndUpdate({ email }, { password: hashedPassword }, { new: true });

    if (!user) return res.status(400).json({ message: "User not found" });

    // Remove the used verification code
    delete verificationCodes[email];

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Password Has Been Reseted",
        text: "Your password has been reset . If not done by you please contact admin"
    };
    try {
        await transporter.sendMail(mailOptions);
    } catch (emailError) {
        console.error("Error sending email:", emailError);
    }

    // Generate a new token for automatic login
    const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.json({ message: "Password reset successful", token, user: { username: user.username, admin: user.admin } });
});

module.exports = router;
