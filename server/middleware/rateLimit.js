const rateLimit = require("express-rate-limit");

/**
 * Creates a rate limiter with consistent error format.
 */
function createLimiter(opts) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        status: "error",
        statusCode: 429,
        message: opts.message || "Too many requests. Please slow down.",
      });
    },
    ...opts,
  });
}

// General API: 100 requests per minute per IP
const apiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many API requests. Limit: 100/minute.",
});

// Auth endpoints: 10 attempts per 15 minutes per IP (brute force protection)
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many authentication attempts. Try again in 15 minutes.",
});

// AI/Translation endpoints: 30 per minute per IP (expensive API calls)
const aiLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "AI request limit reached. Limit: 30/minute.",
});

// Media upload: 20 per minute per IP
const uploadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Upload limit reached. Limit: 20/minute.",
});

// Voice upload: 10 per minute per IP (large payloads)
const voiceLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Voice upload limit reached. Limit: 10/minute.",
});

// Media/audio READ (image preview, file download, audio playback).
// These happen frequently: a single chat with 10 images triggers 10 GETs per
// viewer per load. Separate limiter with a much higher threshold.
const mediaReadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 300,
  message: "Media request limit reached. Limit: 300/minute.",
});

module.exports = {
  apiLimiter,
  authLimiter,
  aiLimiter,
  uploadLimiter,
  voiceLimiter,
  mediaReadLimiter,
};
