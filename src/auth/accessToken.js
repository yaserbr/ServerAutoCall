const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_COOKIE_NAME = "autocall_access_token";
const JWT_ALGORITHM = "HS256";
const JWT_SECRET_MIN_BYTES = 32;
const ADMIN_SETUP_KEY_MIN_BYTES = 32;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const MIN_ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
const MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const USER_ID_REGEX = /^[a-f0-9]{24}$/i;

function readTrimmedEnvironmentValue(name) {
  return typeof process.env[name] === "string" ? process.env[name].trim() : "";
}

function getJwtSecret() {
  const secret = readTrimmedEnvironmentValue("JWT_SECRET");
  return Buffer.byteLength(secret, "utf8") >= JWT_SECRET_MIN_BYTES ? secret : "";
}

function getJwtSecretConfigurationIssue() {
  const secret = readTrimmedEnvironmentValue("JWT_SECRET");
  if (!secret) return "missing";
  if (Buffer.byteLength(secret, "utf8") < JWT_SECRET_MIN_BYTES) return "too_short";
  return null;
}

function getAdminSetupKey() {
  const setupKey = readTrimmedEnvironmentValue("ADMIN_SETUP_KEY");
  return Buffer.byteLength(setupKey, "utf8") >= ADMIN_SETUP_KEY_MIN_BYTES
    ? setupKey
    : "";
}

function getAdminSetupKeyConfigurationIssue() {
  const setupKey = readTrimmedEnvironmentValue("ADMIN_SETUP_KEY");
  if (!setupKey) return "missing";
  if (Buffer.byteLength(setupKey, "utf8") < ADMIN_SETUP_KEY_MIN_BYTES) return "too_short";
  return null;
}

function parseAccessTokenTtlSeconds(value) {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  }

  const match = value.trim().toLowerCase().match(/^(\d+)(s|m|h|d)$/);
  if (!match) return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;

  const amount = Number(match[1]);
  const unitSeconds = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60
  }[match[2]];
  const seconds = amount * unitSeconds;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  }

  return Math.max(
    MIN_ACCESS_TOKEN_TTL_SECONDS,
    Math.min(MAX_ACCESS_TOKEN_TTL_SECONDS, seconds)
  );
}

function getAccessTokenTtlSeconds() {
  return parseAccessTokenTtlSeconds(process.env.JWT_ACCESS_EXPIRES_IN);
}

function getJwtIssuer() {
  return readTrimmedEnvironmentValue("JWT_ISSUER") || "autocall-server";
}

function getJwtAudience() {
  return readTrimmedEnvironmentValue("JWT_AUDIENCE") || "autocall-clients";
}

function extractBearerTokenFromHeader(authHeader) {
  if (typeof authHeader !== "string") return "";
  const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1].trim() : "";
}

function extractCookieValue(cookieHeader, cookieName) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return "";

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name !== cookieName) continue;

    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch (_error) {
      return "";
    }
  }

  return "";
}

function extractAccessTokenFromRequest(req) {
  const bearerToken = extractBearerTokenFromHeader(req?.headers?.authorization);
  if (bearerToken) {
    return { token: bearerToken, source: "bearer" };
  }

  const cookieToken = extractCookieValue(
    req?.headers?.cookie,
    ACCESS_TOKEN_COOKIE_NAME
  );
  if (cookieToken) {
    return { token: cookieToken, source: "cookie" };
  }

  return { token: "", source: "none" };
}

function signAccessToken(user) {
  const jwtSecret = getJwtSecret();
  if (!jwtSecret) return "";

  return jwt.sign(
    {
      sub: String(user._id),
      username: user.username
    },
    jwtSecret,
    {
      algorithm: JWT_ALGORITHM,
      audience: getJwtAudience(),
      expiresIn: getAccessTokenTtlSeconds(),
      issuer: getJwtIssuer(),
      jwtid: crypto.randomUUID()
    }
  );
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
    const payload = jwt.verify(normalizedToken, jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      audience: getJwtAudience(),
      issuer: getJwtIssuer(),
      maxAge: getAccessTokenTtlSeconds()
    });
    const userId = typeof payload?.sub === "string" ? payload.sub : "";
    if (!USER_ID_REGEX.test(userId)) {
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

function shouldUseSecureCookie(req) {
  if (process.env.NODE_ENV === "production") return true;
  return req?.secure === true;
}

function setAccessTokenCookie(req, res, token) {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: getAccessTokenTtlSeconds() * 1000,
    path: "/",
    sameSite: "strict",
    secure: shouldUseSecureCookie(req)
  });
}

function clearAccessTokenCookie(req, res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: shouldUseSecureCookie(req)
  });
}

function isSecretEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  ACCESS_TOKEN_COOKIE_NAME,
  ADMIN_SETUP_KEY_MIN_BYTES,
  JWT_SECRET_MIN_BYTES,
  clearAccessTokenCookie,
  extractAccessTokenFromRequest,
  extractBearerTokenFromHeader,
  extractCookieValue,
  getAccessTokenTtlSeconds,
  getAdminSetupKey,
  getAdminSetupKeyConfigurationIssue,
  getJwtSecret,
  getJwtSecretConfigurationIssue,
  isSecretEqual,
  setAccessTokenCookie,
  signAccessToken,
  verifyAccessToken
};
