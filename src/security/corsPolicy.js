function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim() || value.trim() === "null") {
    return "";
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch (_error) {
    return "";
  }
}

function getConfiguredAllowedOrigins() {
  const values = typeof process.env.CORS_ALLOWED_ORIGINS === "string"
    ? process.env.CORS_ALLOWED_ORIGINS.split(",")
    : [];
  return [...new Set(values.map(normalizeOrigin).filter(Boolean))];
}

function resolveRequestOrigin(req) {
  const forwardedProtocol = typeof req?.headers?.["x-forwarded-proto"] === "string"
    ? req.headers["x-forwarded-proto"].split(",")[0].trim().toLowerCase()
    : "";
  const directProtocol = req?.socket?.encrypted ? "https" : "http";
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : directProtocol;
  const host = typeof req?.headers?.host === "string" ? req.headers.host.trim() : "";
  return host ? normalizeOrigin(`${protocol}://${host}`) : "";
}

function isRequestOriginAllowed(origin, req, configuredOrigins = getConfiguredAllowedOrigins()) {
  if (origin === undefined || origin === null || origin === "") return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;
  if (configuredOrigins.includes(normalizedOrigin)) return true;

  const requestOrigin = resolveRequestOrigin(req);
  return Boolean(requestOrigin) && normalizedOrigin === requestOrigin;
}

function createExpressCorsMiddleware(cors, logSecurityEvent) {
  const configuredOrigins = getConfiguredAllowedOrigins();

  return (req, res, next) => {
    const origin = req.headers?.origin;
    if (!isRequestOriginAllowed(origin, req, configuredOrigins)) {
      logSecurityEvent("cors_origin_rejected", {
        ip: req.ip,
        method: req.method,
        path: req.originalUrl
      });
      return res.status(403).json({ error: "Origin not allowed" });
    }

    return cors({
      allowedHeaders: [
        "Authorization",
        "Content-Type",
        "X-Admin-Setup-Key",
        "X-Device-Token",
        "X-Device-Uid"
      ],
      credentials: true,
      exposedHeaders: ["X-Page", "X-Page-Size", "X-Has-More"],
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      origin: origin ? normalizeOrigin(origin) : false
    })(req, res, next);
  };
}

function buildSocketCorsOptions() {
  const configuredOrigins = getConfiguredAllowedOrigins();
  return {
    credentials: true,
    methods: ["GET", "POST"],
    origin: configuredOrigins.length > 0 ? configuredOrigins : false
  };
}

module.exports = {
  buildSocketCorsOptions,
  createExpressCorsMiddleware,
  getConfiguredAllowedOrigins,
  isRequestOriginAllowed,
  normalizeOrigin
};
