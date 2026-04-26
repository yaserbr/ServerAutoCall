const jwt = require("jsonwebtoken");

function getJwtSecret() {
  return typeof process.env.JWT_SECRET === "string"
    ? process.env.JWT_SECRET.trim()
    : "";
}

function requireAuth(req, res, next) {
  const authHeader = req.headers?.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing bearer token" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing bearer token" });
  }

  const jwtSecret = getJwtSecret();
  if (!jwtSecret) {
    return res.status(503).json({
      error: "Authentication is disabled: JWT_SECRET is not configured"
    });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const userId = typeof payload?.sub === "string" ? payload.sub : null;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: invalid token payload" });
    }

    req.user = {
      id: userId,
      username: typeof payload.username === "string" ? payload.username : null
    };
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = { requireAuth };
