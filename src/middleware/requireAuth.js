const { logSecurityEvent } = require("../security/auditLogger");
const {
  extractAccessTokenFromRequest,
  extractBearerTokenFromHeader,
  getJwtSecret,
  verifyAccessToken
} = require("../auth/accessToken");
const { safeErrorMetadata } = require("../security/safeError");

function requireAuth(req, res, next) {
  const { token, source } = extractAccessTokenFromRequest(req);
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
    console.error("[Auth] Authentication is disabled: JWT_SECRET is not configured");
    return res.status(500).json({
      error: "Internal server error"
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
      username: verification.username,
      tokenSource: source
    };
    return next();
  } catch (error) {
    logSecurityEvent("user_auth_context_failed", {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
      ...safeErrorMetadata(error)
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
