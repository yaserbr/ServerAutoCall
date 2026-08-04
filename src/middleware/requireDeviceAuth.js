const Device = require("../models/Device");
const { isDeviceTokenMatch, normalizeDeviceToken } = require("../auth/deviceToken");
const { logSecurityEvent } = require("../security/auditLogger");
const { ensureDeviceOwnershipEpoch } = require("../security/deviceOwnership");

const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);
const UNAUTHORIZED_ERROR = "Unauthorized";

function parseRequestBodyObject(body) {
  if (!body) return {};

  if (typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function pickFirstDefinedValue(payload, keys) {
  if (!payload || typeof payload !== "object") return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    const stringValue = String(value).trim();
    if (!stringValue) continue;
    return value;
  }
  return undefined;
}

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

function extractDeviceUidFromRequest(req, options = {}) {
  if (typeof options.resolveDeviceUid === "function") {
    const resolvedValue = options.resolveDeviceUid(req);
    return normalizeDeviceUid(resolvedValue);
  }

  const payload = parseRequestBodyObject(req.body);
  const bodyKeys = Array.isArray(options.deviceUidKeys) && options.deviceUidKeys.length > 0
    ? options.deviceUidKeys
    : ["deviceUid", "deviceUID", "uid", "deviceId", "id"];

  const rawFromBody = pickFirstDefinedValue(payload, bodyKeys);
  const rawFromParams = pickFirstDefinedValue(req.params, bodyKeys);
  const rawFromQuery = pickFirstDefinedValue(req.query, bodyKeys);
  const rawFromHeader =
    typeof req.headers?.["x-device-uid"] === "string" ? req.headers["x-device-uid"] : undefined;

  return normalizeDeviceUid(
    rawFromBody ?? rawFromParams ?? rawFromQuery ?? rawFromHeader ?? ""
  );
}

function extractDeviceTokenFromRequest(req) {
  const payload = parseRequestBodyObject(req.body);
  const rawFromBody = pickFirstDefinedValue(payload, [
    "deviceToken",
    "token",
    "authToken"
  ]);

  const rawFromHeader =
    typeof req.headers?.["x-device-token"] === "string" ? req.headers["x-device-token"] : "";

  return normalizeDeviceToken(rawFromHeader || rawFromBody || "");
}

function rejectUnauthorized(req, res, reason, extra = {}) {
  console.warn("[DeviceAuth] Device request rejected", {
    reason,
    path: req.originalUrl,
    method: req.method,
    deviceUid: extra.deviceUid ?? null
  });
  logSecurityEvent("device_auth_failed", {
    reason,
    ip: req.ip,
    path: req.originalUrl,
    method: req.method,
    ...extra
  });
  return res.status(401).json({ error: UNAUTHORIZED_ERROR });
}

function buildRequireDeviceAuth(options = {}) {
  return async function requireDeviceAuth(req, res, next) {
    const normalizedDeviceUid = extractDeviceUidFromRequest(req, options);
    if (!normalizedDeviceUid) {
      return res
        .status(400)
        .json({ error: `deviceUid must be exactly ${DEVICE_UID_LENGTH} lowercase letters or digits` });
    }

    const providedDeviceToken = extractDeviceTokenFromRequest(req);
    const device = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
      "+deviceTokenHash +ownershipEpoch"
    );
    if (!device) {
      return rejectUnauthorized(req, res, "device_not_found", {
        deviceUid: normalizedDeviceUid
      });
    }

    const hasTokenHash =
      typeof device.deviceTokenHash === "string" && device.deviceTokenHash.trim() !== "";

    if (!hasTokenHash) {
      return rejectUnauthorized(req, res, "device_token_missing_on_server", {
        deviceUid: normalizedDeviceUid
      });
    }

    if (!providedDeviceToken) {
      return rejectUnauthorized(req, res, "device_token_missing", {
        deviceUid: normalizedDeviceUid
      });
    }

    if (!isDeviceTokenMatch(providedDeviceToken, device.deviceTokenHash)) {
      return rejectUnauthorized(req, res, "device_token_mismatch", {
        deviceUid: normalizedDeviceUid
      });
    }

    if (!(await ensureDeviceOwnershipEpoch(device))) {
      return rejectUnauthorized(req, res, "device_ownership_epoch_missing", {
        deviceUid: normalizedDeviceUid
      });
    }

    req.authenticatedDevice = device;
    req.deviceUid = normalizedDeviceUid;
    req.deviceToken = providedDeviceToken;
    req.deviceAuthNeedsProvision = false;
    return next();
  };
}

module.exports = {
  buildRequireDeviceAuth,
  normalizeDeviceUid,
  extractDeviceTokenFromRequest,
  parseRequestBodyObject,
  pickFirstDefinedValue
};
