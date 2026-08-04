const test = require("node:test");
const assert = require("node:assert/strict");

const createDevicesRouter = require("../src/routes/devices");
const {
  createDeviceEnrollmentRateLimiter
} = require("../src/middleware/deviceEnrollmentRateLimit");

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

function createChallengeStore({ token = "bootstrap-token", userId = "user-1", expiresAtMs } = {}) {
  const record = {
    token,
    tokenHash: `hash:${token}`,
    userId,
    expiresAtMs: expiresAtMs ?? Date.now() + 5 * 60 * 1000,
    used: false
  };

  return {
    record,
    async inspect(pairingToken, pairingCode) {
      if (pairingCode) {
        return {
          ok: false,
          reason: "invalid_pairing_code",
          credentialType: "code",
          tokenHash: "",
          userId: ""
        };
      }
      if (pairingToken !== record.token) {
        return {
          ok: false,
          reason: "invalid_pairing_token",
          credentialType: "token",
          tokenHash: "",
          userId: ""
        };
      }
      if (record.used) {
        return {
          ok: false,
          reason: "pairing_token_used",
          credentialType: "token",
          tokenHash: record.tokenHash,
          userId: record.userId
        };
      }
      if (record.expiresAtMs <= Date.now()) {
        return {
          ok: false,
          reason: "pairing_token_expired",
          credentialType: "token",
          tokenHash: record.tokenHash,
          userId: record.userId
        };
      }
      return {
        ok: true,
        reason: "ok",
        credentialType: "token",
        tokenHash: record.tokenHash,
        userId: record.userId
      };
    },
    async consume(tokenHash) {
      if (tokenHash !== record.tokenHash) {
        return { ok: false, reason: "invalid_pairing_token" };
      }
      if (record.expiresAtMs <= Date.now()) {
        return { ok: false, reason: "pairing_token_expired" };
      }
      if (record.used) {
        return { ok: false, reason: "pairing_token_used" };
      }

      // The state change happens before yielding, mirroring MongoDB's atomic
      // findOneAndUpdate used by the production challenge consumer.
      record.used = true;
      await Promise.resolve();
      return { ok: true, reason: "ok", userId: record.userId };
    }
  };
}

function createDeviceRouterHarness({ challengeStore = createChallengeStore() } = {}) {
  const devices = new Map();
  let issuedTokenCount = 0;

  class FakeDevice {
    constructor(properties) {
      Object.assign(this, properties);
      this._id = `${properties.deviceUid}-id`;
    }

    async save() {
      const current = devices.get(this.deviceUid);
      if (current && current !== this) {
        const error = new Error("duplicate deviceUid");
        error.code = 11000;
        throw error;
      }
      devices.set(this.deviceUid, this);
      return this;
    }

    static findOne(filter) {
      return {
        select: async () => devices.get(filter.deviceUid) || null
      };
    }
  }

  const passThrough = (_req, _res, next) => next();
  const normalizeDeviceUid = (value) =>
    typeof value === "string" && /^[a-z0-9]{5}$/.test(value.trim().toLowerCase())
      ? value.trim().toLowerCase()
      : "";
  const normalizeName = (value) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : null;
  const failureStatus = (reason) => ({
    invalid_pairing_token: 404,
    pairing_token_used: 409,
    pairing_token_expired: 410,
    pairing_service_unavailable: 503
  })[reason] || 400;
  const failureMessage = (reason) => ({
    invalid_pairing_token: "Invalid pairing token",
    pairing_token_used: "Pairing token already used",
    pairing_token_expired: "Pairing token expired",
    pairing_service_unavailable: "Device enrollment temporarily unavailable"
  })[reason] || "Invalid pairing token";

  const router = createDevicesRouter({
    Device: FakeDevice,
    User: { exists: async ({ _id }) => _id === challengeStore.record.userId },
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
    isDeviceTokenMatch: (provided, storedHash) => storedHash === `device-hash:${provided}`,
    logSecurityEvent: () => {},
    buildDefaultDeviceName: (deviceUid) => `Device-${deviceUid.toUpperCase()}`,
    normalizeDeviceName: normalizeName,
    issueDeviceTokenForDevice: (device) => {
      issuedTokenCount += 1;
      const token = `issued-device-token-${issuedTokenCount}`;
      device.deviceTokenHash = `device-hash:${token}`;
      device.deviceTokenIssuedAt = new Date();
      return token;
    },
    mapDeviceForResponseWithLinkedAccount: async (device) => ({
      deviceUid: device.deviceUid,
      deviceName: device.deviceName,
      linkedAccount: device.ownerUserId ? { id: String(device.ownerUserId) } : null
    }),
    mapDeviceListForResponseWithLinkedAccount: async () => [],
    handleServerError: (res, error) =>
      res.status(error?.code === 11000 ? 409 : 500).json({ error: "Internal server error" }),
    normalizeAuthUserId: (value) => (typeof value === "string" ? value : ""),
    parseIncludeUnclaimedQueryValue: () => false,
    normalizePairingToken: (value) => (typeof value === "string" ? value.trim() : ""),
    normalizeManualPairingCode: (value) => (typeof value === "string" ? value.trim() : ""),
    inspectPairingCredential: (token, code) => challengeStore.inspect(token, code),
    getPairingCredentialFailureHttpStatus: failureStatus,
    getPairingCredentialFailureMessage: failureMessage,
    getPairingCredentialFailureMessageForType: failureMessage,
    consumePairingTokenByHash: (hash) => challengeStore.consume(hash),
    hashDeviceToken: (token) => `device-hash:${token}`,
    isDeviceOwnedByUser: () => true,
    mapDeviceForResponse: (device) => ({ deviceUid: device.deviceUid }),
    parseRequestBodyObject: (body) => body || {},
    DEVICE_UID_FORMAT_ERROR: "invalid deviceUid",
    translatePairingTokenReasonToCodeReason: (reason) => reason,
    revokeDashboardAccessForDevice: async () => {}
  });

  async function invoke(path, body) {
    const layer = router.stack.find((candidate) => candidate.route?.path === path);
    assert.ok(layer, `route ${path} must exist`);
    const handler = layer.route.stack.at(-1).handle;
    const req = {
      body,
      headers: {},
      ip: "203.0.113.10",
      originalUrl: path,
      method: "POST"
    };
    const res = createResponseRecorder();
    await handler(req, res);
    return res;
  }

  return {
    challengeStore,
    devices,
    getIssuedTokenCount: () => issuedTokenCount,
    invoke
  };
}

test("anonymous registration cannot create a device or issue a token", async () => {
  const harness = createDeviceRouterHarness();
  const response = await harness.invoke("/devices/register", { deviceUid: "abc12" });

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "device_enrollment_required");
  assert.equal(harness.devices.size, 0);
  assert.equal(harness.getIssuedTokenCount(), 0);
});

test("a valid single-use pairing challenge enrolls a new device", async () => {
  const harness = createDeviceRouterHarness();
  const response = await harness.invoke("/devices/pair", {
    pairingToken: harness.challengeStore.record.token,
    deviceUid: "abc12",
    deviceName: "Test phone",
    platform: "android"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.deviceToken, "issued-device-token-1");
  assert.equal(harness.challengeStore.record.used, true);
  assert.equal(harness.devices.get("abc12").ownerUserId, "user-1");
});

test("invalid and expired pairing credentials cannot enroll a device", async (t) => {
  await t.test("invalid credential", async () => {
    const harness = createDeviceRouterHarness();
    const response = await harness.invoke("/devices/pair", {
      pairingToken: "not-the-challenge",
      deviceUid: "abc12"
    });

    assert.equal(response.statusCode, 404);
    assert.equal(harness.devices.size, 0);
    assert.equal(harness.getIssuedTokenCount(), 0);
  });

  await t.test("expired credential", async () => {
    const challengeStore = createChallengeStore({ expiresAtMs: Date.now() - 1 });
    const harness = createDeviceRouterHarness({ challengeStore });
    const response = await harness.invoke("/devices/pair", {
      pairingToken: challengeStore.record.token,
      deviceUid: "abc12"
    });

    assert.equal(response.statusCode, 410);
    assert.equal(harness.devices.size, 0);
    assert.equal(harness.getIssuedTokenCount(), 0);
  });
});

test("a consumed pairing challenge cannot be replayed", async () => {
  const harness = createDeviceRouterHarness();
  const request = {
    pairingToken: harness.challengeStore.record.token,
    deviceUid: "abc12"
  };

  const first = await harness.invoke("/devices/pair", request);
  const replay = await harness.invoke("/devices/pair", request);

  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.error, "Pairing token already used");
  assert.equal(harness.getIssuedTokenCount(), 1);
});

test("concurrent enrollment with one challenge issues exactly one device token", async () => {
  const harness = createDeviceRouterHarness();
  const request = {
    pairingToken: harness.challengeStore.record.token,
    deviceUid: "abc12"
  };

  const responses = await Promise.all([
    harness.invoke("/devices/pair", request),
    harness.invoke("/devices/pair", request)
  ]);

  assert.deepEqual(
    responses.map((response) => response.statusCode).sort((left, right) => left - right),
    [200, 409]
  );
  assert.equal(harness.devices.size, 1);
  assert.equal(harness.getIssuedTokenCount(), 1);
});

test("per-UID enrollment limit is shared through the distributed counter store", async () => {
  class FakeDistributedCounter {
    static counters = new Map();

    static async findOneAndUpdate(filter) {
      const nextCount = (this.counters.get(filter._id) || 0) + 1;
      this.counters.set(filter._id, nextCount);
      return { count: nextCount };
    }
  }

  const options = {
    EnrollmentRateLimit: FakeDistributedCounter,
    isStoreReady: () => true,
    resolveDeviceUid: (req) => req.body.deviceUid,
    logSecurityEvent: () => {},
    now: () => new Date("2026-08-04T00:00:00.000Z"),
    windowMs: 300000,
    ipMax: 100,
    deviceUidMax: 1
  };
  const firstInstanceLimiter = createDeviceEnrollmentRateLimiter(options);
  const secondInstanceLimiter = createDeviceEnrollmentRateLimiter(options);
  const req = {
    body: { deviceUid: "abc12" },
    ip: "203.0.113.10",
    originalUrl: "/devices/pair",
    method: "POST"
  };

  let firstNextCalled = false;
  const firstResponse = createResponseRecorder();
  await firstInstanceLimiter(req, firstResponse, () => {
    firstNextCalled = true;
  });
  const secondResponse = createResponseRecorder();
  await secondInstanceLimiter(req, secondResponse, () => {
    throw new Error("rate-limited request must not continue");
  });

  assert.equal(firstNextCalled, true);
  assert.equal(secondResponse.statusCode, 429);
  assert.ok(Number(secondResponse.headers["retry-after"]) > 0);
});

test("enrollment fails closed when the distributed rate-limit store is unavailable", async () => {
  const limiter = createDeviceEnrollmentRateLimiter({
    EnrollmentRateLimit: { findOneAndUpdate: async () => ({ count: 1 }) },
    isStoreReady: () => false,
    resolveDeviceUid: () => "abc12",
    logSecurityEvent: () => {}
  });
  const response = createResponseRecorder();

  await limiter(
    {
      body: { deviceUid: "abc12" },
      ip: "203.0.113.10",
      originalUrl: "/devices/pair",
      method: "POST"
    },
    response,
    () => {
      throw new Error("unavailable store must not allow enrollment");
    }
  );

  assert.equal(response.statusCode, 503);
});
