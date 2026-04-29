const crypto = require("crypto");

const DEVICE_TOKEN_BYTES = 32;
const DEVICE_TOKEN_REGEX = /^[a-f0-9]{64}$/;

function normalizeDeviceToken(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return DEVICE_TOKEN_REGEX.test(normalized) ? normalized : "";
}

function generateDeviceToken() {
  return crypto.randomBytes(DEVICE_TOKEN_BYTES).toString("hex");
}

function hashDeviceToken(token) {
  const normalized = normalizeDeviceToken(token);
  if (!normalized) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function issueDeviceTokenForDevice(device) {
  const deviceToken = generateDeviceToken();
  device.deviceTokenHash = hashDeviceToken(deviceToken);
  device.deviceTokenIssuedAt = new Date();
  return deviceToken;
}

function isDeviceTokenMatch(providedToken, storedTokenHash) {
  const providedHash = hashDeviceToken(providedToken);
  if (!providedHash) return false;

  if (typeof storedTokenHash !== "string") return false;
  const normalizedStoredHash = storedTokenHash.trim().toLowerCase();
  if (!DEVICE_TOKEN_REGEX.test(normalizedStoredHash)) return false;

  try {
    const left = Buffer.from(providedHash, "hex");
    const right = Buffer.from(normalizedStoredHash, "hex");
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  normalizeDeviceToken,
  generateDeviceToken,
  hashDeviceToken,
  issueDeviceTokenForDevice,
  isDeviceTokenMatch
};
