// Express rate limiter for Gemini endpoints
const rateLimit = require('express-rate-limit');

// Limit: 10 requests per minute per IP
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: "Too many requests, please try again later." }
});

module.exports = { aiLimiter };
