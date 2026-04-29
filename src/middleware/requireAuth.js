const jwt = require("jsonwebtoken");
const { logSecurityEvent } = require("../security/auditLogger");

function getJwtSecret() {
  return typeof process.env.JWT_SECRET === "string"
    ? process.env.JWT_SECRET.trim()
    : "";
}

function extractBearerTokenFromHeader(authHeader) {
  if (typeof authHeader !== "string") return "";
  if (!authHeader.startsWith("Bearer ")) return "";
  return authHeader.slice("Bearer ".length).trim();
}

function verifyAccessToken(token) {
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedToken) {
    return { ok: false, reason: "missing_token" };
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return { ok: false, reason: "auth_disabled" };
  }

  try {
    const payload = jwt.verify(normalizedToken, jwtSecret);
    const userId = typeof payload?.sub === "string" ? payload.sub : "";
    if (!userId) {
      return { ok: false, reason: "invalid_payload" };
    }

    return {
      ok: true,
      reason: "ok",
      userId,
      username: typeof payload.username === "string" ? payload.username : null,
      payload
    };
  } catch (_error) {
    return { ok: false, reason: "invalid_or_expired_token" };
  }
}

function requireAuth(req, res, next) {
  const token = extractBearerTokenFromHeader(req.headers?.authorization);
  if (!token) {
    logSecurityEvent("user_auth_missing_bearer", {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method
    });
    return res.status(401).json({ error: "Unauthorized: missing bearer token" });
  }

  const verification = verifyAccessToken(token);
  if (!verification.ok && verification.reason === "auth_disabled") {
    return res.status(503).json({
      error: "Authentication is disabled: JWT_SECRET is not configured"
    });
  }

  if (!verification.ok) {
    logSecurityEvent("user_auth_invalid_token", {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
      reason: verification.reason
    });
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }

  try {
    req.user = {
      id: verification.userId,
      username: verification.username
    };
    return next();
  } catch (error) {
    logSecurityEvent("user_auth_context_failed", {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
      reason: error?.message || "unknown"
    });
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = {
  requireAuth,
  getJwtSecret,
  extractBearerTokenFromHeader,
  verifyAccessToken
};
