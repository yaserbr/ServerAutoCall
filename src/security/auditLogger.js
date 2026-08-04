const recentSecurityEvents = new Map();
const DEFAULT_DEDUPE_MS = Number(process.env.SECURITY_LOG_DEDUPE_MS || 4000);
const MAX_TRACKED_EVENTS = 5000;

function cleanupExpiredEvents(now, dedupeMs) {
  if (recentSecurityEvents.size <= MAX_TRACKED_EVENTS) return;

  for (const [key, timestamp] of recentSecurityEvents.entries()) {
    if (now - timestamp > dedupeMs) {
      recentSecurityEvents.delete(key);
    }
  }

  while (recentSecurityEvents.size > MAX_TRACKED_EVENTS) {
    const oldestKey = recentSecurityEvents.keys().next().value;
    if (!oldestKey) break;
    recentSecurityEvents.delete(oldestKey);
  }
}

function getSafeRequestPath(value) {
  if (typeof value !== "string") return value;
  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const endIndex = indexes.length > 0 ? Math.min(...indexes) : value.length;
  return value.slice(0, endIndex) || "/";
}

function sanitizeLogValue(key, value, depth = 0) {
  const normalizedKey = String(key).toLowerCase();
  if (
    normalizedKey.includes("token") ||
    normalizedKey.includes("password") ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("authorization") ||
    normalizedKey.includes("credential") ||
    normalizedKey.includes("activationcode")
  ) {
    return "[REDACTED]";
  }
  if (normalizedKey === "path" || normalizedKey === "url") {
    return getSafeRequestPath(value);
  }
  if (depth >= 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue("item", item, depth + 1));
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return compactPayload(value, depth + 1);
  }
  return value;
}

function compactPayload(payload = {}, depth = 0) {
  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    normalized[key] = sanitizeLogValue(key, value, depth);
  }
  return normalized;
}

function buildDedupeKey(event, payload = {}) {
  const ip = payload.ip ?? payload.sourceIp ?? "-";
  const path = getSafeRequestPath(payload.path ?? payload.url ?? "-");
  const userId = payload.userId ?? "-";
  const deviceUid = payload.deviceUid ?? "-";
  const reason = payload.reason ?? payload.code ?? "-";
  return `${event}|${ip}|${path}|${userId}|${deviceUid}|${reason}`;
}

function logSecurityEvent(event, payload = {}, options = {}) {
  const dedupeMs = Number(options.dedupeMs ?? DEFAULT_DEDUPE_MS);
  const dedupeKey = options.dedupeKey || buildDedupeKey(event, payload);
  const now = Date.now();

  if (dedupeMs > 0) {
    const lastSeenAt = recentSecurityEvents.get(dedupeKey);
    if (typeof lastSeenAt === "number" && now - lastSeenAt < dedupeMs) {
      return;
    }
    recentSecurityEvents.set(dedupeKey, now);
    cleanupExpiredEvents(now, dedupeMs);
  }

  const level = options.level === "error" ? "error" : options.level === "info" ? "info" : "warn";
  const logger = console[level] || console.warn;

  logger("[Security]", {
    event,
    timestamp: new Date(now).toISOString(),
    ...compactPayload(payload)
  });
}

module.exports = { getSafeRequestPath, logSecurityEvent };
