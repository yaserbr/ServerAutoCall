const Device = require("../models/Device");
const { isDeviceTokenMatch, normalizeDeviceToken } = require("../auth/deviceToken");
const {
  verifyAccessToken,
  extractBearerTokenFromHeader
} = require("../middleware/requireAuth");
const { logSecurityEvent } = require("../security/auditLogger");

const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

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
  return headerToken;
}

function extractSocketDeviceCredentials(socket) {
  const fromAuth = socket?.handshake?.auth || {};
  const deviceUid = normalizeDeviceUid(
    fromAuth.deviceUid ??
      socket?.handshake?.query?.deviceUid ??
      socket?.handshake?.headers?.["x-device-uid"] ??
      ""
  );

  const deviceToken = normalizeDeviceToken(
    fromAuth.deviceToken ??
      socket?.handshake?.query?.deviceToken ??
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

      const device = await Device.findOne({ deviceUid }).select("+deviceTokenHash");
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

      socket.data.authType = "device";
      socket.data.authenticatedDeviceUid = deviceUid;
      return next();
    } catch (error) {
      logSecurityEvent("socket_auth_internal_error", {
        socketId: socket.id,
        ip: socket.handshake.address,
        reason: error?.message || "unknown"
      });
      return next(new Error("Unauthorized"));
    }
  };
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
  normalizeDeviceUid,
  resolveAuthenticatedDeviceUidFromSocket,
  canDashboardJoinDevice
};
