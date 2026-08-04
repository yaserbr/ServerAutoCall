const crypto = require("crypto");

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_IP_MAX = 30;
const DEFAULT_DEVICE_UID_MAX = 6;
const COUNTER_RETENTION_GRACE_MS = 60 * 1000;

function readBoundedPositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function hashCounterKey(scope, identifier, windowStartedAtMs) {
  return crypto
    .createHash("sha256")
    .update(`${scope}:${identifier}:${windowStartedAtMs}`)
    .digest("hex");
}

function normalizeClientIp(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "unknown";
}

async function incrementCounter(
  EnrollmentRateLimit,
  { counterId, scope, windowStartedAt, expiresAt }
) {
  const filter = { _id: counterId };
  const update = {
    $inc: { count: 1 },
    $setOnInsert: {
      scope,
      windowStartedAt,
      expiresAt
    }
  };

  try {
    return await EnrollmentRateLimit.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: false
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;

    // Two servers may try to create the first counter in a window together.
    // The unique _id makes one insert win; the loser retries as an increment.
    return EnrollmentRateLimit.findOneAndUpdate(
      filter,
      { $inc: { count: 1 } },
      { upsert: false, new: true, setDefaultsOnInsert: false }
    );
  }
}

function createDeviceEnrollmentRateLimiter({
  EnrollmentRateLimit,
  isStoreReady,
  resolveDeviceUid,
  logSecurityEvent,
  now = () => new Date(),
  windowMs = readBoundedPositiveInteger(
    process.env.DEVICE_ENROLLMENT_RATE_WINDOW_MS,
    DEFAULT_WINDOW_MS,
    60 * 1000,
    60 * 60 * 1000
  ),
  ipMax = readBoundedPositiveInteger(
    process.env.DEVICE_ENROLLMENT_RATE_IP_MAX,
    DEFAULT_IP_MAX,
    1,
    1000
  ),
  deviceUidMax = readBoundedPositiveInteger(
    process.env.DEVICE_ENROLLMENT_RATE_UID_MAX,
    DEFAULT_DEVICE_UID_MAX,
    1,
    100
  )
}) {
  if (!EnrollmentRateLimit || typeof EnrollmentRateLimit.findOneAndUpdate !== "function") {
    throw new TypeError("EnrollmentRateLimit model is required");
  }
  if (typeof isStoreReady !== "function") {
    throw new TypeError("isStoreReady callback is required");
  }

  return async function deviceEnrollmentRateLimiter(req, res, next) {
    if (!isStoreReady()) {
      logSecurityEvent("device_enrollment_rate_store_unavailable", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(503).json({ error: "Device enrollment temporarily unavailable" });
    }

    const currentTime = now();
    const currentTimeMs = currentTime.getTime();
    const windowStartedAtMs = Math.floor(currentTimeMs / windowMs) * windowMs;
    const windowStartedAt = new Date(windowStartedAtMs);
    const expiresAt = new Date(windowStartedAtMs + windowMs + COUNTER_RETENTION_GRACE_MS);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowStartedAtMs + windowMs - currentTimeMs) / 1000)
    );
    const normalizedDeviceUid =
      typeof resolveDeviceUid === "function" ? resolveDeviceUid(req) : "";
    const scopes = [
      {
        scope: "ip",
        identifier: normalizeClientIp(req.ip),
        maximum: ipMax
      },
      ...(normalizedDeviceUid
        ? [
            {
              scope: "device_uid",
              identifier: normalizedDeviceUid,
              maximum: deviceUidMax
            }
          ]
        : [])
    ];

    try {
      // Each increment is atomic in MongoDB. Deterministic IDs make the same
      // counter shared across processes while avoiding raw identifiers at rest.
      const counters = await Promise.all(
        scopes.map(async ({ scope, identifier, maximum }) => {
          const counter = await incrementCounter(EnrollmentRateLimit, {
            counterId: hashCounterKey(scope, identifier, windowStartedAtMs),
            scope,
            windowStartedAt,
            expiresAt
          });

          return {
            scope,
            count: Number(counter?.count || 0),
            maximum
          };
        })
      );

      const exceededCounter = counters.find((counter) => counter.count > counter.maximum);
      if (exceededCounter) {
        logSecurityEvent("device_enrollment_rate_limit_blocked", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          deviceUid: normalizedDeviceUid || null,
          scope: exceededCounter.scope
        });
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          error: "Too many device enrollment attempts. Please try again later."
        });
      }

      return next();
    } catch (error) {
      // Enrollment fails closed if the distributed counter cannot be updated.
      logSecurityEvent("device_enrollment_rate_limit_failed", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        deviceUid: normalizedDeviceUid || null,
        reason: error?.name || "rate_limit_store_error"
      });
      return res.status(503).json({ error: "Device enrollment temporarily unavailable" });
    }
  };
}

module.exports = {
  DEFAULT_DEVICE_UID_MAX,
  DEFAULT_IP_MAX,
  DEFAULT_WINDOW_MS,
  createDeviceEnrollmentRateLimiter,
  hashCounterKey
};
