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

function compactPayload(payload = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return normalized;
}

function buildDedupeKey(event, payload = {}) {
  const ip = payload.ip ?? payload.sourceIp ?? "-";
  const path = payload.path ?? payload.url ?? "-";
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

module.exports = { logSecurityEvent };
