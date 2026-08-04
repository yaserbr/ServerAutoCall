const rateLimit = require("express-rate-limit");
const { logSecurityEvent } = require("./auditLogger");

function buildLimiter({
  name,
  windowMs,
  max,
  message,
  keyGenerator
}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler: (req, res) => {
      logSecurityEvent("rate_limit_blocked", {
        limiter: name,
        ip: req.ip,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(429).json({ error: message });
    }
  });
}

const authRateLimiter = buildLimiter({
  name: "auth",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many authentication attempts. Please try again later."
});

const commandRateLimiter = buildLimiter({
  name: "commands",
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many command requests. Please slow down."
});

const deviceRateLimiter = buildLimiter({
  name: "devices",
  windowMs: 60 * 1000,
  max: 240,
  message: "Too many device requests. Please slow down."
});

const agentRateLimiter = buildLimiter({
  name: "agent",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many agent requests. Please try again later."
});

const dummyDownloadRateLimiter = buildLimiter({
  name: "dummy_download",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many download requests. Please try again later."
});

module.exports = {
  agentRateLimiter,
  authRateLimiter,
  commandRateLimiter,
  deviceRateLimiter,
  dummyDownloadRateLimiter
};
