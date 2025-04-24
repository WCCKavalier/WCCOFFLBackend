// utils/mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "Gmail", // or any email provider
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendNewPlayerEmail(name) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "abhisheknarayanm2001@gmail.com", // Replace with your target email
    subject: `New Player Added: ${name}`,
    text: `A new player named ${name} has been added to the database.`,
  };

  await transporter.sendMail(mailOptions);
}

async function sendPingFailureAlert(subject, message) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "varunvinod30@gmail.com",
    subject,
    text: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("📧 Ping failure alert email sent.");
  } catch (error) {
    console.error("❌ Failed to send ping failure alert:", error.message);
  }
}

module.exports = {
  sendNewPlayerEmail,
  sendPingFailureAlert, // ⬅️ Export the new function
};
