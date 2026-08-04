const Device = require("../models/Device");
const { isDeviceTokenMatch, normalizeDeviceToken } = require("../auth/deviceToken");
const {
  ACCESS_TOKEN_COOKIE_NAME,
  extractCookieValue,
  verifyAccessToken,
  extractBearerTokenFromHeader
} = require("../auth/accessToken");
const { logSecurityEvent } = require("../security/auditLogger");
const { safeErrorMetadata } = require("../security/safeError");
const { normalizeDeviceUid } = require("../domain/deviceUid");
const { ensureDeviceSessionEpoch } = require("../security/deviceSession");

function extractSocketBearerToken(socket) {
  const authToken =
    typeof socket?.handshake?.auth?.accessToken === "string"
      ? socket.handshake.auth.accessToken
      : typeof socket?.handshake?.auth?.token === "string"
        ? socket.handshake.auth.token
        : "";

  const normalizedAuthToken = authToken.trim();
  if (normalizedAuthToken) return normalizedAuthToken;

  const headerToken = extractBearerTokenFromHeader(socket?.handshake?.headers?.authorization);
  if (headerToken) return headerToken;

  return extractCookieValue(
    socket?.handshake?.headers?.cookie,
    ACCESS_TOKEN_COOKIE_NAME
  );
}

function extractSocketDeviceCredentials(socket) {
  const fromAuth = socket?.handshake?.auth || {};
  const deviceUid = normalizeDeviceUid(
    fromAuth.deviceUid ??
      socket?.handshake?.headers?.["x-device-uid"] ??
      socket?.handshake?.query?.deviceUid ??
      ""
  );

  const deviceToken = normalizeDeviceToken(
    fromAuth.deviceToken ??
      socket?.handshake?.headers?.["x-device-token"] ??
      ""
  );

  return { deviceUid, deviceToken };
}

function isDashboardSocket(socket) {
  return socket?.data?.authType === "dashboard";
}

function isDeviceSocket(socket) {
  return socket?.data?.authType === "device";
}

function getSocketAuthenticatedDeviceUid(socket) {
  return normalizeDeviceUid(socket?.data?.authenticatedDeviceUid);
}

function resolveAuthenticatedDeviceUidFromSocket(socket, payload = {}) {
  const authenticatedDeviceUid = getSocketAuthenticatedDeviceUid(socket);
  if (authenticatedDeviceUid) {
    const payloadDeviceUid = normalizeDeviceUid(payload?.deviceUid);
    if (payloadDeviceUid && payloadDeviceUid !== authenticatedDeviceUid) {
      logSecurityEvent("socket_device_uid_mismatch", {
        socketId: socket.id,
        deviceUid: authenticatedDeviceUid,
        payloadDeviceUid
      });
    }
    return authenticatedDeviceUid;
  }

  return normalizeDeviceUid(payload?.deviceUid);
}

function createSocketAuthMiddleware() {
  return async (socket, next) => {
    try {
      const bearerToken = extractSocketBearerToken(socket);
      if (bearerToken) {
        const verification = verifyAccessToken(bearerToken);
        if (verification.ok) {
          socket.data.authType = "dashboard";
          socket.data.userId = verification.userId;
          socket.data.username = verification.username ?? null;
          const expiresAtSeconds = Number(verification.payload?.exp);
          if (Number.isFinite(expiresAtSeconds)) {
            const delayMs = Math.max(0, expiresAtSeconds * 1000 - Date.now());
            const expiryTimer = setTimeout(() => socket.disconnect(true), delayMs);
            if (typeof expiryTimer.unref === "function") expiryTimer.unref();
            socket.once("disconnect", () => clearTimeout(expiryTimer));
          }
          return next();
        }

        logSecurityEvent("socket_dashboard_auth_failed", {
          socketId: socket.id,
          ip: socket.handshake.address,
          reason: verification.reason
        });
        return next(new Error("Unauthorized"));
      }

      const { deviceUid, deviceToken } = extractSocketDeviceCredentials(socket);
      if (!deviceUid || !deviceToken) {
        logSecurityEvent("socket_missing_credentials", {
          socketId: socket.id,
          ip: socket.handshake.address
        });
        return next(new Error("Unauthorized"));
      }

      const device = await Device.findOne({ deviceUid }).select(
        "+deviceTokenHash +deviceSessionEpoch"
      );
      if (!device) {
        logSecurityEvent("socket_device_not_found", {
          socketId: socket.id,
          deviceUid,
          ip: socket.handshake.address
        });
        return next(new Error("Unauthorized"));
      }

      if (!isDeviceTokenMatch(deviceToken, device.deviceTokenHash)) {
        logSecurityEvent("socket_device_auth_failed", {
          socketId: socket.id,
          deviceUid,
          ip: socket.handshake.address
        });
        return next(new Error("Unauthorized"));
      }

      const deviceSessionEpoch = await ensureDeviceSessionEpoch(device);
      if (!deviceSessionEpoch) {
        logSecurityEvent("socket_device_session_epoch_missing", {
          socketId: socket.id,
          deviceUid,
          ip: socket.handshake.address
        });
        return next(new Error("Unauthorized"));
      }

      socket.data.authType = "device";
      socket.data.authenticatedDeviceUid = deviceUid;
      socket.data.deviceSessionEpoch = deviceSessionEpoch;
      return next();
    } catch (error) {
      logSecurityEvent("socket_auth_internal_error", {
        socketId: socket.id,
        ip: socket.handshake.address,
        ...safeErrorMetadata(error)
      });
      return next(new Error("Unauthorized"));
    }
  };
}

async function isDeviceSocketSessionCurrent(socket) {
  if (!isDeviceSocket(socket)) return false;

  const deviceUid = getSocketAuthenticatedDeviceUid(socket);
  const deviceSessionEpoch =
    typeof socket?.data?.deviceSessionEpoch === "string"
      ? socket.data.deviceSessionEpoch.trim()
      : "";
  if (!deviceUid || !deviceSessionEpoch) return false;

  const currentDevice = await Device.exists({ deviceUid, deviceSessionEpoch });
  return Boolean(currentDevice);
}

async function canDashboardJoinDevice(userId, deviceUid) {
  if (!userId) {
    return false;
  }

  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) {
    return false;
  }

  const device = await Device.findOne({
    deviceUid: normalizedDeviceUid
  });
  if (!device?.ownerUserId) {
    return false;
  }

  return String(device.ownerUserId) === String(userId);
}

module.exports = {
  createSocketAuthMiddleware,
  isDashboardSocket,
  isDeviceSocket,
  isDeviceSocketSessionCurrent,
  normalizeDeviceUid,
  resolveAuthenticatedDeviceUidFromSocket,
  canDashboardJoinDevice
};
