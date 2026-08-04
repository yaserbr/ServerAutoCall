const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const createDevicesRouter = require("../src/routes/devices");
const { createDeviceSessionRevoker } = require("../src/services/deviceSessionService");

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    set(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function createFakeSocket(deviceUid, id) {
  return {
    id,
    connected: true,
    received: [],
    data: {
      authType: "device",
      authenticatedDeviceUid: deviceUid
    },
    emit(event, payload) {
      if (this.connected) this.received.push({ event, payload });
    },
    disconnect() {
      this.connected = false;
    }
  };
}

function createSocketHarness(deviceUid, socketCount = 2, pendingSocketCount = 0) {
  const roomName = `device:${deviceUid}`;
  const activeSockets = Array.from(
    { length: socketCount },
    (_value, index) => createFakeSocket(deviceUid, `socket-${index + 1}`)
  );
  const pendingSockets = Array.from(
    { length: pendingSocketCount },
    (_value, index) => createFakeSocket(deviceUid, `pending-socket-${index + 1}`)
  );
  const sockets = [...activeSockets, ...pendingSockets];
  const rooms = new Map([
    [roomName, activeSockets],
    [`device-pending:${deviceUid}`, pendingSockets]
  ]);

  const io = {
    in(name) {
      return {
        async fetchSockets() {
          return (rooms.get(name) || []).filter((socket) => socket.connected);
        },
        disconnectSockets() {
          for (const socket of rooms.get(name) || []) socket.connected = false;
        }
      };
    },
    emitToRoom(name, event, payload) {
      for (const socket of rooms.get(name) || []) socket.emit(event, payload);
    }
  };

  const unregisteredSocketIds = [];
  const revokeDeviceSessions = createDeviceSessionRevoker({
    io,
    unregisterDeviceSocketConnection: (socketId) => unregisteredSocketIds.push(socketId),
    emitDevicePresenceStatus: () => {},
    logSecurityEvent: () => {}
  });

  return { io, sockets, revokeDeviceSessions, unregisteredSocketIds };
}

function createRouterHarness({ revokeDeviceSessions }) {
  const devices = new Map();
  let issuedTokenSequence = 0;
  let challengeConsumed = false;

  class FakeDevice {
    constructor(properties) {
      Object.assign(this, properties);
      this._id = `${properties.deviceUid}-${crypto.randomUUID()}`;
      this.deviceSessionEpoch = crypto.randomUUID();
    }

    async save() {
      devices.set(this.deviceUid, this);
      return this;
    }

    async deleteOne() {
      devices.delete(this.deviceUid);
    }

    static findOne(filter) {
      const resolveDevice = () => devices.get(filter.deviceUid) || null;
      return {
        select: async () => resolveDevice(),
        then: (resolve, reject) => Promise.resolve(resolveDevice()).then(resolve, reject)
      };
    }
  }

  const passThrough = (_req, _res, next) => next();
  const normalizeDeviceUid = (value) =>
    typeof value === "string" && /^[a-z0-9]{5}$/.test(value.trim().toLowerCase())
      ? value.trim().toLowerCase()
      : "";
  const normalizeName = (value) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const router = createDevicesRouter({
    Device: FakeDevice,
    User: { exists: async () => true },
    requireAuth: passThrough,
    requireAuthenticatedDevice: passThrough,
    deviceEnrollmentRateLimiter: passThrough,
    extractDeviceRegistrationInput: (body = {}) => ({
      payload: body,
      normalizedDeviceUid: normalizeDeviceUid(body.deviceUid),
      normalizedDeviceName: normalizeName(body.deviceName),
      normalizedPlatform: normalizeName(body.platform)
    }),
    normalizeEsimSubscriptions: (value) => value,
    normalizeDeviceUid,
    extractDeviceTokenFromRequest: (req) => req.body?.deviceToken || "",
    toUtcISOString: () => new Date().toISOString(),
    isDeviceTokenMatch: (provided, storedHash) => storedHash === `hash:${provided}`,
    logSecurityEvent: () => {},
    buildDefaultDeviceName: (uid) => `Device-${uid.toUpperCase()}`,
    normalizeDeviceName: normalizeName,
    issueDeviceTokenForDevice: (device) => {
      issuedTokenSequence += 1;
      const token = `rotated-or-enrolled-token-${issuedTokenSequence}`;
      device.deviceTokenHash = `hash:${token}`;
      device.deviceTokenIssuedAt = new Date();
      return token;
    },
    mapDeviceForResponseWithLinkedAccount: async (device) => ({
      deviceUid: device.deviceUid
    }),
    mapDeviceListForResponseWithLinkedAccount: async () => [],
    handleServerError: (res) => res.status(500).json({ error: "Internal server error" }),
    normalizeAuthUserId: (value) => (typeof value === "string" ? value : ""),
    parseIncludeUnclaimedQueryValue: () => false,
    normalizePairingToken: (value) => (typeof value === "string" ? value.trim() : ""),
    normalizeManualPairingCode: () => "",
    inspectPairingCredential: async (token) =>
      token === "new-pairing-challenge" && !challengeConsumed
        ? {
            ok: true,
            reason: "ok",
            credentialType: "token",
            tokenHash: "challenge-hash",
            userId: "owner-1"
          }
        : { ok: false, reason: "pairing_token_used", credentialType: "token" },
    getPairingCredentialFailureHttpStatus: () => 409,
    getPairingCredentialFailureMessage: () => "Pairing token already used",
    getPairingCredentialFailureMessageForType: () => "Pairing token already used",
    consumePairingTokenByHash: async () => {
      if (challengeConsumed) return { ok: false, reason: "pairing_token_used" };
      challengeConsumed = true;
      return { ok: true, reason: "ok", userId: "owner-1" };
    },
    hashDeviceToken: (token) => `hash:${token}`,
    isDeviceOwnedByUser: (device, userId) => String(device.ownerUserId) === String(userId),
    mapDeviceForResponse: (device) => ({ deviceUid: device.deviceUid }),
    parseRequestBodyObject: (body) => body || {},
    DEVICE_UID_FORMAT_ERROR: "invalid deviceUid",
    translatePairingTokenReasonToCodeReason: (reason) => reason,
    revokeDashboardAccessForDevice: async () => {},
    revokeDeviceSessions
  });

  async function invoke(path, { method = "POST", body = {}, params = {}, user, device } = {}) {
    const layer = router.stack.find(
      (candidate) => candidate.route?.path === path && candidate.route?.methods?.[method.toLowerCase()]
    );
    assert.ok(layer, `${method} ${path} must exist`);
    const handler = layer.route.stack.at(-1).handle;
    const req = {
      body,
      params,
      headers: {},
      ip: "203.0.113.20",
      originalUrl: path,
      method,
      user,
      authenticatedDevice: device,
      deviceUid: device?.deviceUid
    };
    const res = createResponseRecorder();
    await handler(req, res);
    return res;
  }

  return { devices, FakeDevice, invoke };
}

test("deleting a connected device disconnects every socket before future commands", async () => {
  const sockets = createSocketHarness("abc12", 3, 1);
  const router = createRouterHarness({ revokeDeviceSessions: sockets.revokeDeviceSessions });
  const device = new router.FakeDevice({
    deviceUid: "abc12",
    ownerUserId: "owner-1",
    deviceTokenHash: "hash:old-token"
  });
  await device.save();

  const response = await router.invoke("/devices/:deviceUid", {
    method: "DELETE",
    params: { deviceUid: "abc12" },
    user: { id: "owner-1" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(router.devices.has("abc12"), false);
  assert.equal(sockets.sockets.every((socket) => !socket.connected), true);
  assert.deepEqual(sockets.unregisteredSocketIds.sort(), [
    "pending-socket-1",
    "socket-1",
    "socket-2",
    "socket-3"
  ]);
  assert.equal(
    sockets.sockets.every((socket) =>
      socket.received.some(
        (message) =>
          message.event === "security:error" && message.payload.reason === "device_deleted"
      )
    ),
    true
  );

  sockets.io.emitToRoom("device:abc12", "command:new", { id: "must-not-arrive" });
  assert.equal(
    sockets.sockets.some((socket) =>
      socket.received.some((message) => message.event === "command:new")
    ),
    false
  );
});

test("a deleted device can re-register without reviving its revoked sockets", async () => {
  const sockets = createSocketHarness("abc12", 2);
  const router = createRouterHarness({ revokeDeviceSessions: sockets.revokeDeviceSessions });
  const deletedDevice = new router.FakeDevice({
    deviceUid: "abc12",
    ownerUserId: "owner-1",
    deviceTokenHash: "hash:old-token"
  });
  const deletedSessionEpoch = deletedDevice.deviceSessionEpoch;
  await deletedDevice.save();

  await router.invoke("/devices/:deviceUid", {
    method: "DELETE",
    params: { deviceUid: "abc12" },
    user: { id: "owner-1" }
  });
  const enrollment = await router.invoke("/devices/pair", {
    body: { deviceUid: "abc12", pairingToken: "new-pairing-challenge" }
  });

  const reRegisteredDevice = router.devices.get("abc12");
  assert.equal(enrollment.statusCode, 200);
  assert.equal(enrollment.body.deviceToken, "rotated-or-enrolled-token-1");
  assert.notEqual(reRegisteredDevice.deviceSessionEpoch, deletedSessionEpoch);
  assert.equal(sockets.sockets.every((socket) => !socket.connected), true);
});

test("token rotation invalidates the old HTTP token and all simultaneous sockets", async () => {
  const sockets = createSocketHarness("abc12", 2);
  const router = createRouterHarness({ revokeDeviceSessions: sockets.revokeDeviceSessions });
  const device = new router.FakeDevice({
    deviceUid: "abc12",
    ownerUserId: "owner-1",
    deviceTokenHash: "hash:old-token"
  });
  const previousEpoch = device.deviceSessionEpoch;
  await device.save();

  const response = await router.invoke("/devices/token/rotate", { device });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.deviceToken, "rotated-or-enrolled-token-1");
  assert.equal(device.deviceTokenHash, "hash:rotated-or-enrolled-token-1");
  assert.notEqual(device.deviceSessionEpoch, previousEpoch);
  assert.equal(sockets.sockets.every((socket) => !socket.connected), true);
});
