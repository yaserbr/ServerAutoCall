require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const path = require("path");
const http = require("http");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Server: SocketIOServer } = require("socket.io");

const { connectToDatabase } = require("./src/config/db");
const Device = require("./src/models/Device");
const Command = require("./src/models/Command");
const User = require("./src/models/User");
const { requireAuth } = require("./src/middleware/requireAuth");
const {
  buildRequireDeviceAuth,
  extractDeviceTokenFromRequest
} = require("./src/middleware/requireDeviceAuth");
const { issueDeviceTokenForDevice, isDeviceTokenMatch } = require("./src/auth/deviceToken");
const { sanitizeRequestBody } = require("./src/security/requestSanitizer");
const {
  authRateLimiter,
  commandRateLimiter,
  deviceRateLimiter
} = require("./src/security/rateLimits");
const { logSecurityEvent } = require("./src/security/auditLogger");
const {
  createSocketAuthMiddleware,
  isDashboardSocket,
  isDeviceSocket,
  resolveAuthenticatedDeviceUidFromSocket,
  canDashboardJoinDevice
} = require("./src/socket/auth");

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

app.set("trust proxy", 1);

process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);
app.use(express.json());
app.use(express.text({ type: ["text/plain"] }));
app.use(sanitizeRequestBody);
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
  });
  next();
});

app.use("/auth", authRateLimiter);
app.use("/commands", commandRateLimiter);
app.use("/devices", deviceRateLimiter);

const RIYADH_TIMEZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MINUTES = 3 * 60;
const DEVICE_NAME_MAX_LENGTH = 60;
const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);
const DEVICE_UID_FORMAT_ERROR = `deviceUid must be exactly ${DEVICE_UID_LENGTH} lowercase letters or digits`;
const COMMAND_FETCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const BCRYPT_SALT_ROUNDS = 10;
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "7d";
const COMMAND_CLAIM_SORT = { isImmediate: -1, scheduledAt: 1, createdAt: 1, _id: 1 };
const DUMMY_DOWNLOAD_MIN_MB = 10;
const DUMMY_DOWNLOAD_MAX_MB = 1000;
const DUMMY_DOWNLOAD_CHUNK_BYTES = 64 * 1024;
const SCREEN_MIRROR_MAX_FRAME_BYTES = Math.floor(1.5 * 1024 * 1024);
const OPEN_APP_PACKAGE_REGEX = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/;
const DEVICE_AUTH_ALLOW_LEGACY_FALLBACK =
  String(process.env.DEVICE_AUTH_ALLOW_LEGACY_FALLBACK || "").trim().toLowerCase() === "true";
const screenMirrorSessions = new Map();
const requireAuthenticatedDevice = buildRequireDeviceAuth({
  allowLegacyFallback: DEVICE_AUTH_ALLOW_LEGACY_FALLBACK
});
const requireAuthenticatedDeviceAllowBootstrap = buildRequireDeviceAuth({
  allowMissingTokenHash: true,
  allowLegacyFallback: DEVICE_AUTH_ALLOW_LEGACY_FALLBACK
});
const OPEN_APP_ALIAS_DEFINITIONS = [
  { packageName: "com.whatsapp", aliases: ["whatsapp", "whats app", "wa"] },
  { packageName: "org.telegram.messenger", aliases: ["telegram", "telegram app", "tg"] },
  { packageName: "com.google.android.youtube", aliases: ["youtube", "youtube app", "yt"] },
  { packageName: "com.android.chrome", aliases: ["chrome", "google chrome", "chrome browser"] },
  { packageName: "com.snapchat.android", aliases: ["snapchat", "snap chat"] },
  { packageName: "com.zhiliaoapp.musically", aliases: ["tiktok", "tik tok", "tiktok app"] },
  { packageName: "com.instagram.android", aliases: ["instagram", "insta", "ig"] },
  { packageName: "com.twitter.android", aliases: ["x", "twitter", "x twitter", "twitter x"] },
  { packageName: "com.facebook.katana", aliases: ["facebook", "fb", "facebook app"] },
  { packageName: "com.google.android.gm", aliases: ["gmail", "google mail"] },
  { packageName: "com.google.android.apps.maps", aliases: ["maps", "google maps"] },
  { packageName: "com.facebook.orca", aliases: ["messenger", "facebook messenger"] },
  {
    packageName: "com.google.android.apps.messaging",
    aliases: ["messages", "google messages", "sms app"]
  },
  { packageName: "com.skype.raider", aliases: ["skype"] },
  { packageName: "us.zoom.videomeetings", aliases: ["zoom", "zoom meetings"] },
  { packageName: "com.google.android.apps.meetings", aliases: ["google meet", "meet", "gmeet"] },
  { packageName: "com.spotify.music", aliases: ["spotify"] },
  { packageName: "com.netflix.mediaclient", aliases: ["netflix"] },
  { packageName: "com.linkedin.android", aliases: ["linkedin"] },
  { packageName: "com.ubercab", aliases: ["uber"] },
  { packageName: "com.ubercab.eats", aliases: ["uber eats", "ubereats"] },
  { packageName: "com.google.android.apps.docs", aliases: ["google drive", "drive"] },
  { packageName: "com.android.vending", aliases: ["play store", "google play", "playstore"] },
  { packageName: "com.google.android.calendar", aliases: ["calendar", "google calendar"] },
  { packageName: "com.google.android.apps.photos", aliases: ["photos", "google photos"] },
  {
    packageName: "com.google.android.apps.translate",
    aliases: ["translate", "google translate"]
  }
];

// Time strategy:
// 1) Storage format: UTC timestamps in MongoDB.
// 2) Response display format: Asia/Riyadh localized string for end users.
// 3) Parsing input format: datetime-local is interpreted as Riyadh local time, then converted to UTC.
function toUtcISOString(date = new Date()) {
  return new Date(date).toISOString();
}

function parseScheduledAtAsRiyadhToUtcDate(value) {
  if (!value || typeof value !== "string") return null;

  const hasExplicitTimezone = /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
  if (hasExplicitTimezone) {
    return new Date(value);
  }

  // Expected from datetime-local: YYYY-MM-DDTHH:mm (optional :ss).
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return new Date(NaN);

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute) - RIYADH_UTC_OFFSET_MINUTES,
    Number(second)
  );

  return new Date(utcMillis);
}

function formatUtcForRiyadhDisplay(dateValue) {
  if (!dateValue) return null;
  return new Date(dateValue).toLocaleString("en-GB", {
    timeZone: RIYADH_TIMEZONE,
    hour12: false
  });
}

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

function normalizeDeviceName(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, DEVICE_NAME_MAX_LENGTH);
}

function normalizeHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function parseDownloadSizeMb(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < DUMMY_DOWNLOAD_MIN_MB || parsed > DUMMY_DOWNLOAD_MAX_MB) {
    return null;
  }

  return parsed;
}

function hasPresentValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

function addIfPresent(obj, key, value) {
  if (!obj || typeof obj !== "object") return;
  if (hasPresentValue(value)) {
    obj[key] = value;
  }
}

function unsetIfPresent(document, key) {
  if (!document || typeof document.get !== "function" || typeof document.set !== "function") {
    return;
  }

  if (document.get(key) !== undefined) {
    document.set(key, undefined);
  }
}

function normalizeOpenAppAliasKey(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOpenAppAliasCandidates(value) {
  const normalized = normalizeOpenAppAliasKey(value);
  if (!normalized) return [];

  const withoutGenericWords = normalized
    .replace(/\b(app|application|android|mobile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const candidates = new Set();
  const addCandidate = (candidateValue) => {
    if (!candidateValue) return;
    const compact = candidateValue.replace(/\s+/g, "");
    if (candidateValue) candidates.add(candidateValue);
    if (compact) candidates.add(compact);
  };

  addCandidate(normalized);
  addCandidate(withoutGenericWords);

  return [...candidates];
}

const OPEN_APP_ALIAS_RESOLVER_MAP = (() => {
  const aliasMap = new Map();

  for (const definition of OPEN_APP_ALIAS_DEFINITIONS) {
    const packageName = String(definition.packageName || "").trim().toLowerCase();
    if (!packageName) continue;

    const aliases = Array.isArray(definition.aliases) ? definition.aliases : [];
    for (const alias of aliases) {
      for (const key of buildOpenAppAliasCandidates(alias)) {
        aliasMap.set(key, { packageName, matchedAlias: alias });
      }
    }

    aliasMap.set(packageName, { packageName, matchedAlias: packageName });
    aliasMap.set(packageName.replace(/\./g, ""), {
      packageName,
      matchedAlias: packageName
    });
  }

  return aliasMap;
})();

function resolveOpenAppTarget(value) {
  const normalizedAppName =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

  if (!normalizedAppName) {
    return {
      normalizedAppName: "",
      resolvedPackageName: null,
      matchedAlias: null,
      usedFallback: true
    };
  }

  if (OPEN_APP_PACKAGE_REGEX.test(normalizedAppName)) {
    return {
      normalizedAppName,
      resolvedPackageName: normalizedAppName.toLowerCase(),
      matchedAlias: "direct_package_name",
      usedFallback: false
    };
  }

  const candidates = buildOpenAppAliasCandidates(normalizedAppName);
  for (const candidate of candidates) {
    const resolved = OPEN_APP_ALIAS_RESOLVER_MAP.get(candidate);
    if (resolved?.packageName) {
      return {
        normalizedAppName,
        resolvedPackageName: resolved.packageName,
        matchedAlias: resolved.matchedAlias ?? null,
        usedFallback: false
      };
    }
  }

  return {
    normalizedAppName,
    resolvedPackageName: null,
    matchedAlias: null,
    usedFallback: true
  };
}

function logOpenAppResolver(payload = {}) {
  console.log("[OpenAppResolver]", {
    timestamp: nowIsoTimestamp(),
    appName: payload.appName ?? null,
    normalizedAppName: payload.normalizedAppName ?? null,
    resolvedPackageName: payload.resolvedPackageName ?? null,
    matchedAlias: payload.matchedAlias ?? null,
    usedFallback: payload.usedFallback ?? null,
    commandId: payload.commandId ?? null,
    deviceUid: payload.deviceUid ?? null
  });
}

function logReturnToAutoCallEvent(payload = {}) {
  console.log("[ReturnToAutoCall]", {
    timestamp: nowIsoTimestamp(),
    stage: payload.stage ?? null,
    commandId: payload.commandId ?? null,
    deviceUid: payload.deviceUid ?? null,
    status: payload.status ?? null,
    failureReason: payload.failureReason ?? null
  });
}

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
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function extractDeviceRegistrationInput(body) {
  const payload = parseRequestBodyObject(body);
  const nestedDevicePayload =
    payload.device && typeof payload.device === "object" ? payload.device : {};

  const rawDeviceUid = pickFirstDefinedValue(payload, [
    "deviceUid",
    "deviceUID",
    "uid",
    "deviceId",
    "id",
    "installationId"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "deviceUid",
    "deviceUID",
    "uid",
    "deviceId",
    "id",
    "installationId"
  ]);

  const rawDeviceName = pickFirstDefinedValue(payload, [
    "deviceName",
    "name",
    "device_name",
    "model"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "deviceName",
    "name",
    "device_name",
    "model"
  ]);

  const rawPlatform = pickFirstDefinedValue(payload, [
    "platform",
    "os",
    "osName"
  ]) ?? pickFirstDefinedValue(nestedDevicePayload, [
    "platform",
    "os",
    "osName"
  ]);

  return {
    payload,
    normalizedDeviceUid: normalizeDeviceUid(rawDeviceUid),
    normalizedDeviceName: normalizeDeviceName(rawDeviceName),
    normalizedPlatform: normalizeDeviceName(rawPlatform)
  };
}

function buildDefaultDeviceName(deviceUid) {
  const sanitized = String(deviceUid || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");
  return `Device-${sanitized}`;
}

function ensureDeviceName(device) {
  return normalizeDeviceName(device?.deviceName) ?? buildDefaultDeviceName(device?.deviceUid);
}

function toPlainObject(documentOrObject) {
  if (!documentOrObject) return documentOrObject;
  if (typeof documentOrObject.toObject === "function") {
    return documentOrObject.toObject();
  }
  return documentOrObject;
}

function mapDeviceForResponse(device) {
  const source = toPlainObject(device);

  return {
    deviceUid: source.deviceUid,
    deviceName: ensureDeviceName(source),
    platform: source.platform ?? null,
    online: Boolean(source.online),
    lastSeen: formatUtcForRiyadhDisplay(source.lastSeen)
  };
}

function mapCommandForResponse(command) {
  const source = toPlainObject(command);

  return {
    id: source._id ? String(source._id) : null,
    deviceUid: source.deviceUid,
    action: source.action,
    type: source.type,
    phoneNumber: source.phoneNumber ?? null,
    message: source.message ?? null,
    url: source.url ?? null,
    appName: source.appName ?? null,
    resolvedPackageName: source.resolvedPackageName ?? null,
    notes: source.notes ?? null,
    durationSeconds: source.durationSeconds ?? null,
    downloadSizeMb: source.downloadSizeMb ?? null,
    downloadDurationSeconds: source.downloadDurationSeconds ?? null,
    enabled: source.enabled ?? null,
    autoHangupSeconds: source.autoHangupSeconds ?? null,
    status: source.status,
    failureReason: source.failureReason ?? null,
    scheduledAt: formatUtcForRiyadhDisplay(source.scheduledAt),
    isImmediate:
      typeof source.isImmediate === "boolean"
        ? source.isImmediate
        : !source.scheduledAt,
    createdAt: formatUtcForRiyadhDisplay(source.createdAt),
    executedAt: formatUtcForRiyadhDisplay(source.executedAt)
  };
}

function redactSensitivePayload(value, depth = 0) {
  if (depth > 6) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item, depth + 1));
  }
  if (typeof value !== "object") return value;

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase();
    const isSensitiveKey = normalizedKey.includes("token") || normalizedKey.includes("password");
    output[key] = isSensitiveKey ? "[REDACTED]" : redactSensitivePayload(nestedValue, depth + 1);
  }
  return output;
}

function parseUsername(rawUsername) {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return "";
  if (normalized.length > 50) return "";
  return normalized;
}

function parsePassword(rawPassword) {
  if (typeof rawPassword !== "string") return "";
  const normalized = rawPassword.trim();
  if (normalized.length < 1 || normalized.length > 200) return "";
  return normalized;
}

function normalizeAuthUserId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return mongoose.isValidObjectId(normalized) ? normalized : "";
}

function isSameObjectId(left, right) {
  if (left === undefined || left === null) return false;
  if (right === undefined || right === null) return false;
  return String(left) === String(right);
}

function isDeviceOwnedByUser(device, userId) {
  return Boolean(device?.ownerUserId) && isSameObjectId(device.ownerUserId, userId);
}

function parseIncludeUnclaimedQueryValue(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase() === "true";
}

function nowIsoTimestamp() {
  return new Date(toUtcISOString()).toISOString();
}

function commandIdFrom(commandOrObject) {
  const source = toPlainObject(commandOrObject);
  if (!source) return null;
  return source._id ? String(source._id) : null;
}

function getCommandFetchCutoffDate() {
  return new Date(Date.now() - COMMAND_FETCH_WINDOW_MS);
}

function buildDuePendingCommandFilter(deviceUid) {
  return {
    deviceUid,
    status: "pending",
    createdAt: { $gte: getCommandFetchCutoffDate() },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date(toUtcISOString()) } }]
  };
}

function logCommandLifecycle(eventName, payload = {}) {
  console.log("[CommandLifecycle]", {
    event: eventName,
    timestamp: nowIsoTimestamp(),
    commandId: payload.commandId ?? null,
    deviceUid: payload.deviceUid ?? null,
    oldStatus: payload.oldStatus ?? null,
    newStatus: payload.newStatus ?? null,
    count: payload.count ?? null,
    ids: payload.ids ?? null,
    details: payload.details ?? null
  });
}

function handleServerError(res, error, contextLabel) {
  console.error(`[${contextLabel}]`, error);
  return res.status(500).json({ error: "Internal server error" });
}

function getJwtSecret() {
  return typeof process.env.JWT_SECRET === "string"
    ? process.env.JWT_SECRET.trim()
    : "";
}

function isAuthEnabled() {
  return Boolean(getJwtSecret());
}

function getAdminSetupKey() {
  return typeof process.env.ADMIN_SETUP_KEY === "string"
    ? process.env.ADMIN_SETUP_KEY.trim()
    : "";
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function mapUserForResponse(user) {
  const source = toPlainObject(user);
  return {
    id: source?._id ? String(source._id) : null,
    username: source?.username ?? null,
    createdAt: source?.createdAt ?? null
  };
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
    { expiresIn: JWT_ACCESS_EXPIRES_IN }
  );
}

function respondAuthDisabled(res) {
  return res.status(503).json({
    error: "Authentication is disabled: JWT_SECRET is not configured"
  });
}

function resolveScreenMirrorDeviceUid(socket, payload = {}) {
  return resolveAuthenticatedDeviceUidFromSocket(socket, payload);
}

function ensureScreenMirrorSession(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return null;

  if (!screenMirrorSessions.has(normalizedDeviceUid)) {
    screenMirrorSessions.set(normalizedDeviceUid, {
      status: "idle",
      startedAt: null,
      lastFrameAt: null,
      frameCount: 0
    });
  }

  return screenMirrorSessions.get(normalizedDeviceUid) ?? null;
}

function buildScreenMirrorStatus(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) {
    return null;
  }

  const session = ensureScreenMirrorSession(normalizedDeviceUid);
  if (!session) {
    return null;
  }

  return {
    deviceUid: normalizedDeviceUid,
    status: session.status ?? "idle",
    startedAt: session.startedAt ?? null,
    lastFrameAt: session.lastFrameAt ?? null,
    frameCount: Number(session.frameCount || 0)
  };
}

function emitScreenMirrorStatus(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return;

  const statusPayload = buildScreenMirrorStatus(normalizedDeviceUid);
  if (!statusPayload) return;

  io.to(`dashboard:${normalizedDeviceUid}`).emit("screen:status", statusPayload);
}

function estimateBase64Bytes(base64Value) {
  if (typeof base64Value !== "string" || !base64Value) return 0;
  const normalized = base64Value.replace(/\s+/g, "");
  const length = normalized.length;
  if (!length) return 0;

  const padding =
    normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((length * 3) / 4) - padding;
}

io.use(createSocketAuthMiddleware());

io.on("connection", (socket) => {
  const requireDeviceSocket = (eventName, payload = {}) => {
    if (!isDeviceSocket(socket)) {
      logSecurityEvent("socket_event_rejected", {
        socketId: socket.id,
        event: eventName,
        reason: "dashboard_socket_cannot_emit_device_event"
      });
      socket.emit("security:error", { event: eventName, reason: "unauthorized" });
      return null;
    }

    const deviceUid = resolveScreenMirrorDeviceUid(socket, payload);
    if (!deviceUid) {
      logSecurityEvent("socket_event_rejected", {
        socketId: socket.id,
        event: eventName,
        reason: "missing_authenticated_device_uid"
      });
      socket.emit("security:error", { event: eventName, reason: "unauthorized" });
      return null;
    }

    return deviceUid;
  };

  socket.on("device:join", (payload = {}) => {
    const deviceUid = requireDeviceSocket("device:join", payload);
    if (!deviceUid) return;

    socket.data.screenMirrorDeviceUid = deviceUid;
    socket.join(`device:${deviceUid}`);
    console.log("[SCREEN_MIRROR] device joined", { deviceUid });
  });

  socket.on("dashboard:join", async (payload = {}) => {
    try {
      if (!isDashboardSocket(socket)) {
        logSecurityEvent("socket_event_rejected", {
          socketId: socket.id,
          event: "dashboard:join",
          reason: "device_socket_cannot_join_dashboard_room"
        });
        socket.emit("security:error", { event: "dashboard:join", reason: "unauthorized" });
        return;
      }

      const deviceUid = normalizeDeviceUid(payload?.deviceUid);
      if (!deviceUid) {
        return;
      }

      const canJoin = await canDashboardJoinDevice(socket.data.userId, deviceUid);
      if (!canJoin) {
        logSecurityEvent("socket_dashboard_join_denied", {
          socketId: socket.id,
          event: "dashboard:join",
          deviceUid,
          userId: socket.data.userId,
          reason: "device_not_owned_by_user"
        });
        socket.emit("security:error", {
          event: "dashboard:join",
          reason: "forbidden"
        });
        return;
      }

      socket.join(`dashboard:${deviceUid}`);
      socket.data.screenMirrorDashboardDeviceUid = deviceUid;
      console.log("[SCREEN_MIRROR] dashboard joined", { deviceUid, userId: socket.data.userId });
      emitScreenMirrorStatus(deviceUid);
    } catch (error) {
      logSecurityEvent("socket_dashboard_join_failed", {
        socketId: socket.id,
        event: "dashboard:join",
        userId: socket.data.userId ?? null,
        reason: error?.message || "unknown"
      });
      socket.emit("security:error", {
        event: "dashboard:join",
        reason: "internal_error"
      });
    }
  });

  socket.on("screen:started", (payload = {}) => {
    const deviceUid = requireDeviceSocket("screen:started", payload);
    if (!deviceUid) return;

    const session = ensureScreenMirrorSession(deviceUid);
    if (!session) return;

    session.status = "live";
    session.startedAt = nowIsoTimestamp();
    session.lastFrameAt = null;
    session.frameCount = 0;

    console.log("[SCREEN_MIRROR] started", { deviceUid });
    emitScreenMirrorStatus(deviceUid);
  });

  socket.on("screen:stopped", (payload = {}) => {
    const deviceUid = requireDeviceSocket("screen:stopped", payload);
    if (!deviceUid) return;

    const session = ensureScreenMirrorSession(deviceUid);
    if (!session) return;

    session.status = "stopped";
    session.lastFrameAt = nowIsoTimestamp();

    console.log("[SCREEN_MIRROR] stopped", {
      deviceUid,
      reason: payload?.reason ?? null
    });
    io.to(`dashboard:${deviceUid}`).emit("screen:status", {
      ...buildScreenMirrorStatus(deviceUid),
      reason: payload?.reason ?? null
    });
  });

  socket.on("screen:error", (payload = {}) => {
    const deviceUid = requireDeviceSocket("screen:error", payload);
    if (!deviceUid) return;

    const session = ensureScreenMirrorSession(deviceUid);
    if (!session) return;

    session.status = "error";
    session.lastFrameAt = nowIsoTimestamp();

    console.log("[SCREEN_MIRROR] error", {
      deviceUid,
      reason: payload?.reason ?? null
    });
    io.to(`dashboard:${deviceUid}`).emit("screen:status", {
      ...buildScreenMirrorStatus(deviceUid),
      reason: payload?.reason ?? null
    });
  });

  socket.on("screen:frame", (payload = {}) => {
    const deviceUid = requireDeviceSocket("screen:frame", payload);
    if (!deviceUid) return;

    const frameBase64 =
      typeof payload?.frameBase64 === "string" ? payload.frameBase64 : "";
    if (!frameBase64) return;

    const estimatedBytes = estimateBase64Bytes(frameBase64);
    if (estimatedBytes > SCREEN_MIRROR_MAX_FRAME_BYTES) {
      console.warn("[SCREEN_MIRROR] frame too large", {
        deviceUid,
        bytes: estimatedBytes
      });
      return;
    }

    const mimeType =
      typeof payload?.mimeType === "string" && payload.mimeType.trim()
        ? payload.mimeType.trim()
        : "image/jpeg";
    const width = Number.isFinite(Number(payload?.width))
      ? Math.max(0, Math.round(Number(payload.width)))
      : null;
    const height = Number.isFinite(Number(payload?.height))
      ? Math.max(0, Math.round(Number(payload.height)))
      : null;
    const timestamp = Number.isFinite(Number(payload?.timestamp))
      ? Math.round(Number(payload.timestamp))
      : Date.now();

    const session = ensureScreenMirrorSession(deviceUid);
    if (!session) return;

    session.status = "live";
    if (!session.startedAt) {
      session.startedAt = nowIsoTimestamp();
    }
    session.lastFrameAt = nowIsoTimestamp();
    session.frameCount = Number(session.frameCount || 0) + 1;

    io.to(`dashboard:${deviceUid}`).emit("screen:frame", {
      deviceUid,
      frameBase64,
      mimeType,
      width,
      height,
      timestamp
    });
    emitScreenMirrorStatus(deviceUid);
  });
});

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  return res.status(200).json({ ok: true });
});

app.get("/dummy-download", requireAuthenticatedDevice, (req, res) => {
  const requestedMb = parseDownloadSizeMb(req.query?.mb);
  if (requestedMb === null) {
    return res.status(400).json({
      error: `mb must be an integer between ${DUMMY_DOWNLOAD_MIN_MB} and ${DUMMY_DOWNLOAD_MAX_MB}`
    });
  }

  const totalBytes = requestedMb * 1024 * 1024;
  const chunk = Buffer.alloc(DUMMY_DOWNLOAD_CHUNK_BYTES, 0x61);
  let remainingBytes = totalBytes;

  console.log("[DummyDownload] start", {
    deviceUid: req.deviceUid ?? null,
    mb: requestedMb
  });

  res.status(200);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(totalBytes));
  res.setHeader("Cache-Control", "no-store");

  const streamChunks = () => {
    while (remainingBytes > 0) {
      const bytesToWrite = Math.min(DUMMY_DOWNLOAD_CHUNK_BYTES, remainingBytes);
      const payload =
        bytesToWrite === DUMMY_DOWNLOAD_CHUNK_BYTES
          ? chunk
          : chunk.subarray(0, bytesToWrite);
      const canContinue = res.write(payload);
      remainingBytes -= bytesToWrite;

      if (!canContinue) {
        res.once("drain", streamChunks);
        return;
      }
    }

    res.end();
  };

  return streamChunks();
});

app.post("/auth/register", async (req, res) => {
  try {
    const adminSetupKey = getAdminSetupKey();
    const providedSetupKey =
      typeof req.headers?.["x-admin-setup-key"] === "string"
        ? req.headers["x-admin-setup-key"].trim()
        : "";

    if (!adminSetupKey || !providedSetupKey || providedSetupKey !== adminSetupKey) {
      return res.status(403).json({ error: "Registration is disabled" });
    }

    if (!isAuthEnabled()) {
      return respondAuthDisabled(res);
    }

    const payload = parseRequestBodyObject(req.body);
    const username = parseUsername(payload.username);
    const password = parsePassword(payload.password);

    if (!username || !password) {
      logSecurityEvent("auth_register_validation_failed", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(400).json({ error: "username and password are required" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: "username already in use" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await User.create({
      username,
      passwordHash
    });

    const accessToken = signAccessToken(user);
    if (!accessToken) {
      return respondAuthDisabled(res);
    }

    return res.status(201).json({
      accessToken,
      user: mapUserForResponse(user)
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "username already in use" });
    }
    return handleServerError(res, error, "POST /auth/register");
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    if (!isAuthEnabled()) {
      return respondAuthDisabled(res);
    }

    const payload = parseRequestBodyObject(req.body);
    const username = parseUsername(payload.username);
    const password = parsePassword(payload.password);

    if (!username || !password) {
      logSecurityEvent("auth_login_validation_failed", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method
      });
      return res.status(400).json({ error: "username and password are required" });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: "invalid username or password" });
    }

    const accessToken = signAccessToken(user);
    if (!accessToken) {
      return respondAuthDisabled(res);
    }

    return res.json({
      accessToken,
      user: mapUserForResponse(user)
    });
  } catch (error) {
    return handleServerError(res, error, "POST /auth/login");
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.json({ user: mapUserForResponse(user) });
  } catch (error) {
    return handleServerError(res, error, "GET /auth/me");
  }
});

// =====================
// Register device
// =====================
app.post("/devices/register", async (req, res) => {
  try {
    const { payload, normalizedDeviceUid, normalizedDeviceName, normalizedPlatform } =
      extractDeviceRegistrationInput(req.body);
    const requestInfo = {
      contentType: req.headers["content-type"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      keys: Object.keys(payload || {}),
      body: redactSensitivePayload(payload)
    };
    console.log("[DeviceRegister] Incoming request:", requestInfo);

    if (!normalizedDeviceUid) {
      console.warn("[DeviceRegister] Validation failed: deviceUid is missing/empty", requestInfo);
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const providedDeviceToken = extractDeviceTokenFromRequest(req);
    const now = new Date(toUtcISOString());
    let device = await Device.findOne({ deviceUid: normalizedDeviceUid }).select("+deviceTokenHash");
    const wasExisting = Boolean(device);
    let issuedDeviceToken = null;

    if (device?.deviceTokenHash) {
      const canAuthenticate = isDeviceTokenMatch(providedDeviceToken, device.deviceTokenHash);
      if (!canAuthenticate) {
        logSecurityEvent("device_register_rejected_bad_token", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          deviceUid: normalizedDeviceUid
        });
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    if (!device) {
      device = new Device({
        deviceUid: normalizedDeviceUid,
        deviceName: normalizedDeviceName ?? buildDefaultDeviceName(normalizedDeviceUid),
        platform: normalizedPlatform,
        online: true,
        lastSeen: now
      });
    } else {
      device.online = true;
      device.lastSeen = now;

      if (normalizedDeviceName) {
        device.deviceName = normalizedDeviceName;
      } else if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }

      if (normalizedPlatform) {
        device.platform = normalizedPlatform;
      }
    }

    if (!device.deviceTokenHash) {
      issuedDeviceToken = issueDeviceTokenForDevice(device);
    }

    try {
      await device.save();
    } catch (error) {
      // Handles rare race condition when two register requests arrive simultaneously.
      if (error?.code === 11000) {
        console.warn("[DeviceRegister] Duplicate deviceUid on save, retrying as update:", {
          deviceUid: normalizedDeviceUid,
          error: error.message
        });

        const existingDevice = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
          "+deviceTokenHash"
        );
        if (!existingDevice) {
          throw error;
        }

        if (existingDevice.deviceTokenHash) {
          const canAuthenticate = isDeviceTokenMatch(
            providedDeviceToken,
            existingDevice.deviceTokenHash
          );
          if (!canAuthenticate) {
            logSecurityEvent("device_register_rejected_bad_token_after_race", {
              ip: req.ip,
              path: req.originalUrl,
              method: req.method,
              deviceUid: normalizedDeviceUid
            });
            return res.status(401).json({ error: "Unauthorized" });
          }
        }

        existingDevice.online = true;
        existingDevice.lastSeen = now;
        if (normalizedDeviceName) {
          existingDevice.deviceName = normalizedDeviceName;
        } else if (!normalizeDeviceName(existingDevice.deviceName)) {
          existingDevice.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
        }
        if (normalizedPlatform) {
          existingDevice.platform = normalizedPlatform;
        }

        if (!existingDevice.deviceTokenHash) {
          issuedDeviceToken = issueDeviceTokenForDevice(existingDevice);
        }

        await existingDevice.save();
        device = existingDevice;
      } else {
        throw error;
      }
    }

    console.log("[DeviceRegister] Registration success:", {
      deviceUid: normalizedDeviceUid,
      mode: wasExisting ? "updated_existing" : "created_new",
      platform: device.platform ?? null
    });

    return res.json({
      success: true,
      device: mapDeviceForResponse(device),
      ...(issuedDeviceToken ? { deviceToken: issuedDeviceToken } : {})
    });
  } catch (error) {
    console.error("[DeviceRegister] Registration failed:", {
      error: error?.message,
      stack: error?.stack
    });
    return handleServerError(res, error, "POST /devices/register");
  }
});

// =====================
// Heartbeat
// =====================
app.post("/devices/heartbeat", requireAuthenticatedDeviceAllowBootstrap, async (req, res) => {
  try {
    const { payload } = extractDeviceRegistrationInput(req.body);
    const normalizedDeviceUid = req.deviceUid;
    const device = req.authenticatedDevice;
    console.log("[DeviceHeartbeat] Incoming request:", {
      contentType: req.headers["content-type"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
      keys: Object.keys(payload || {}),
      body: redactSensitivePayload(payload)
    });

    if (!normalizedDeviceUid) {
      console.warn("[DeviceHeartbeat] Validation failed: deviceUid is missing/empty");
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    if (!device) {
      logSecurityEvent("device_heartbeat_missing_authenticated_device", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        deviceUid: normalizedDeviceUid
      });
      return res.status(401).json({ error: "Unauthorized" });
    }

    let issuedDeviceToken = null;
    if (req.deviceAuthNeedsProvision === true && !device.deviceTokenHash) {
      issuedDeviceToken = issueDeviceTokenForDevice(device);
    }

    device.online = true;
    device.lastSeen = new Date(toUtcISOString());

    if (!normalizeDeviceName(device.deviceName)) {
      device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
    }

    await device.save();
    console.log("[DeviceHeartbeat] Updated existing device:", {
      deviceUid: normalizedDeviceUid
    });

    return res.json({
      success: true,
      device: mapDeviceForResponse(device),
      ...(issuedDeviceToken ? { deviceToken: issuedDeviceToken } : {})
    });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/heartbeat");
  }
});

// =====================
// Get devices
// =====================
app.get("/devices", requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const includeUnclaimed = parseIncludeUnclaimedQueryValue(req.query?.unclaimed);
    const devices = await Device.find({
      deviceUid: { $regex: DEVICE_UID_REGEX },
      ...(includeUnclaimed
        ? { $or: [{ ownerUserId: currentUserId }, { ownerUserId: null }] }
        : { ownerUserId: currentUserId })
    });

    return res.json(devices.map(mapDeviceForResponse));
  } catch (error) {
    return handleServerError(res, error, "GET /devices");
  }
});

app.post("/devices/claim", requireAuth, async (req, res) => {
  try {
    const payload = parseRequestBodyObject(req.body);
    const normalizedDeviceUid = normalizeDeviceUid(payload?.deviceUid);
    const currentUserId = normalizeAuthUserId(req.user?.id);

    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const existingDevice = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!existingDevice) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!existingDevice.ownerUserId) {
      const claimedAt = new Date(toUtcISOString());
      const claimedDevice = await Device.findOneAndUpdate(
        { deviceUid: normalizedDeviceUid, ownerUserId: null },
        {
          $set: {
            ownerUserId: currentUserId,
            claimedAt
          }
        },
        { new: true }
      );

      if (claimedDevice) {
        return res.json({ success: true, device: mapDeviceForResponse(claimedDevice) });
      }

      const refreshedDevice = await Device.findOne({ deviceUid: normalizedDeviceUid });
      if (!refreshedDevice) {
        return res.status(404).json({ error: "Device not found" });
      }

      if (isDeviceOwnedByUser(refreshedDevice, currentUserId)) {
        return res.json({ success: true, device: mapDeviceForResponse(refreshedDevice) });
      }

      return res.status(409).json({ error: "Device already claimed by another user" });
    }

    if (isDeviceOwnedByUser(existingDevice, currentUserId)) {
      return res.json({ success: true, device: mapDeviceForResponse(existingDevice) });
    }

    return res.status(409).json({ error: "Device already claimed by another user" });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/claim");
  }
});

app.post("/devices/unclaim", requireAuth, async (req, res) => {
  try {
    const payload = parseRequestBodyObject(req.body);
    const normalizedDeviceUid = normalizeDeviceUid(payload?.deviceUid);
    const currentUserId = normalizeAuthUserId(req.user?.id);

    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.ownerUserId) {
      return res.json({ success: true, device: mapDeviceForResponse(device) });
    }

    if (!isDeviceOwnedByUser(device, currentUserId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    device.ownerUserId = null;
    device.claimedAt = null;
    await device.save();

    return res.json({ success: true, device: mapDeviceForResponse(device) });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/unclaim");
  }
});

app.delete("/devices/:deviceUid", requireAuth, async (req, res) => {
  try {
    const normalizedDeviceUid = normalizeDeviceUid(req.params?.deviceUid);
    const currentUserId = normalizeAuthUserId(req.user?.id);

    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.ownerUserId) {
      return res.status(403).json({ error: "Device is not claimed" });
    }

    if (!isDeviceOwnedByUser(device, currentUserId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await device.deleteOne();

    return res.json({
      success: true,
      message: "Device deleted",
      device: mapDeviceForResponse(device)
    });
  } catch (error) {
    return handleServerError(res, error, "DELETE /devices/:deviceUid");
  }
});

app.post("/devices/rename", requireAuth, async (req, res) => {
  try {
    const payload = parseRequestBodyObject(req.body);
    const normalizedDeviceUid = normalizeDeviceUid(payload?.deviceUid);
    const normalizedDeviceName = normalizeDeviceName(payload?.deviceName);
    const currentUserId = normalizeAuthUserId(req.user?.id);

    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }
    if (!normalizedDeviceName) {
      return res.status(400).json({ error: "deviceName is required" });
    }

    const device = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!device) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!device.ownerUserId) {
      return res.status(403).json({ error: "Device is not claimed" });
    }

    if (!isDeviceOwnedByUser(device, currentUserId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    device.deviceName = normalizedDeviceName;
    await device.save();

    return res.json({ success: true, device: mapDeviceForResponse(device) });
  } catch (error) {
    return handleServerError(res, error, "POST /devices/rename");
  }
});

// =====================
// Create command
// =====================
app.post("/commands", requireAuth, async (req, res) => {
  try {
    const {
      deviceUid,
      action,
      type,
      phoneNumber,
      message,
      url,
      appName,
      notes,
      scheduledAt,
      durationSeconds,
      downloadSizeMb,
      enabled,
      autoHangupSeconds
    } = req.body;

    const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const targetDevice = await Device.findOne({ deviceUid: normalizedDeviceUid });
    if (!targetDevice) {
      return res.status(404).json({ error: "Device not found" });
    }

    if (!targetDevice.ownerUserId) {
      return res.status(403).json({ error: "Device is not claimed" });
    }

    if (!isDeviceOwnedByUser(targetDevice, currentUserId)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let scheduledAtDate = null;
    const actionToType = {
      call: "CALL",
      end: "END",
      sms: "SMS",
      auto_answer: "AUTO_ANSWER",
      open_url: "OPEN_URL",
      close_webview: "CLOSE_WEBVIEW",
      open_app: "OPEN_APP",
      return_to_autocall: "RETURN_TO_AUTOCALL",
      download_data: "DOWNLOAD_DATA",
      start_screen_mirror: "START_SCREEN_MIRROR",
      stop_screen_mirror: "STOP_SCREEN_MIRROR"
    };
    const typeToAction = {
      CALL: "call",
      END: "end",
      SMS: "sms",
      AUTO_ANSWER: "auto_answer",
      OPEN_URL: "open_url",
      CLOSE_WEBVIEW: "close_webview",
      OPEN_APP: "open_app",
      RETURN_TO_AUTOCALL: "return_to_autocall",
      DOWNLOAD_DATA: "download_data",
      START_SCREEN_MIRROR: "start_screen_mirror",
      STOP_SCREEN_MIRROR: "stop_screen_mirror"
    };

    const normalizedActionInput =
      typeof action === "string" && action.trim()
        ? action.trim().toLowerCase()
        : null;
    const normalizedTypeInput =
      typeof type === "string" && type.trim()
        ? type.trim().toUpperCase()
        : null;

    if (normalizedActionInput && !actionToType[normalizedActionInput]) {
      logSecurityEvent("command_rejected_invalid_action", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        action: normalizedActionInput,
        deviceUid: normalizedDeviceUid
      });
      return res.status(400).json({
        error:
          "Invalid action. Only 'call', 'end', 'sms', 'auto_answer', 'open_url', 'close_webview', 'open_app', 'return_to_autocall', 'download_data', 'start_screen_mirror', and 'stop_screen_mirror' are supported."
      });
    }

    if (normalizedTypeInput && !typeToAction[normalizedTypeInput]) {
      logSecurityEvent("command_rejected_invalid_type", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        type: normalizedTypeInput,
        deviceUid: normalizedDeviceUid
      });
      return res.status(400).json({
        error:
          "Invalid type. Only 'CALL', 'END', 'SMS', 'AUTO_ANSWER', 'OPEN_URL', 'CLOSE_WEBVIEW', 'OPEN_APP', 'RETURN_TO_AUTOCALL', 'DOWNLOAD_DATA', 'START_SCREEN_MIRROR', and 'STOP_SCREEN_MIRROR' are supported."
      });
    }

    if (
      normalizedActionInput &&
      normalizedTypeInput &&
      actionToType[normalizedActionInput] !== normalizedTypeInput
    ) {
      logSecurityEvent("command_rejected_action_type_mismatch", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        action: normalizedActionInput,
        type: normalizedTypeInput,
        deviceUid: normalizedDeviceUid
      });
      return res.status(400).json({
        error: "action and type mismatch"
      });
    }

    const normalizedAction =
      normalizedActionInput ?? typeToAction[normalizedTypeInput] ?? "call";
    const commandType = normalizedTypeInput ?? actionToType[normalizedAction];
    const isAutoAnswerCommand = normalizedAction === "auto_answer";
    const isOpenUrlCommand = normalizedAction === "open_url";
    const isOpenAppCommand = normalizedAction === "open_app";
    const isReturnToAutoCallCommand = normalizedAction === "return_to_autocall";
    const isDownloadDataCommand = normalizedAction === "download_data";
    const allowsExtraPayloadFields = isReturnToAutoCallCommand;

    const receivedPhoneNumberRaw = typeof phoneNumber === "string" ? phoneNumber : "";
    const normalizedPhoneNumber = receivedPhoneNumberRaw.trim();
    const requiresPhoneNumber = normalizedAction === "call" || normalizedAction === "sms";
    if (requiresPhoneNumber && !normalizedPhoneNumber) {
      return res.status(400).json({
        error: "phoneNumber is required for CALL and SMS commands"
      });
    }

    if (!requiresPhoneNumber && normalizedPhoneNumber && !allowsExtraPayloadFields) {
      return res.status(400).json({
        error: "phoneNumber is only supported for CALL and SMS commands"
      });
    }

    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    if (normalizedAction === "sms" && !normalizedMessage) {
      return res.status(400).json({
        error: "message is required for SMS commands"
      });
    }

    if (normalizedAction !== "sms" && normalizedMessage && !allowsExtraPayloadFields) {
      return res.status(400).json({
        error: "message is only supported for SMS commands"
      });
    }

    const normalizedUrlRaw = typeof url === "string" ? url.trim() : "";
    const normalizedUrl = normalizedUrlRaw ? normalizeHttpUrl(normalizedUrlRaw) : null;
    if (isOpenUrlCommand) {
      if (!normalizedUrlRaw) {
        return res.status(400).json({
          error: "url is required for OPEN_URL commands"
        });
      }

      if (!normalizedUrl) {
        return res.status(400).json({
          error: "url must be a valid http:// or https:// URL"
        });
      }
    }

    if (!isOpenUrlCommand && normalizedUrlRaw && !allowsExtraPayloadFields) {
      return res.status(400).json({
        error: "url is only supported for OPEN_URL commands"
      });
    }

    const normalizedAppNameRaw = typeof appName === "string" ? appName.trim() : "";
    let normalizedAppName = normalizedAppNameRaw
      ? normalizedAppNameRaw.replace(/\s+/g, " ")
      : "";
    let normalizedResolvedPackageName = null;
    let openAppResolution = null;
    if (isOpenAppCommand) {
      if (!normalizedAppName) {
        return res.status(400).json({
          error: "appName is required for OPEN_APP commands"
        });
      }

      openAppResolution = resolveOpenAppTarget(normalizedAppName);
      normalizedAppName = openAppResolution.normalizedAppName;
      normalizedResolvedPackageName = openAppResolution.resolvedPackageName;
    } else if (normalizedAppNameRaw && !allowsExtraPayloadFields) {
      return res.status(400).json({
        error: "appName is only supported for OPEN_APP commands"
      });
    }

    const normalizedNotes = typeof notes === "string" ? notes.trim() : "";

    let normalizedDurationSeconds;
    if (
      normalizedAction === "call" &&
      durationSeconds !== undefined &&
      durationSeconds !== null
    ) {
      const parsedDuration = Number(durationSeconds);
      if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
        return res
          .status(400)
          .json({ error: "durationSeconds must be a number greater than 0" });
      }
      normalizedDurationSeconds = parsedDuration;
    }

    if (
      normalizedAction !== "call" &&
      durationSeconds !== undefined &&
      durationSeconds !== null &&
      !allowsExtraPayloadFields
    ) {
      return res.status(400).json({
        error: "durationSeconds is only supported for CALL commands"
      });
    }

    let normalizedDownloadSizeMb;
    if (isDownloadDataCommand) {
      const parsedDownloadSizeMb = parseDownloadSizeMb(downloadSizeMb);
      if (parsedDownloadSizeMb === null) {
        return res.status(400).json({
          error: `downloadSizeMb is required and must be an integer between ${DUMMY_DOWNLOAD_MIN_MB} and ${DUMMY_DOWNLOAD_MAX_MB}`
        });
      }
      normalizedDownloadSizeMb = parsedDownloadSizeMb;
    } else if (
      downloadSizeMb !== undefined &&
      downloadSizeMb !== null &&
      !allowsExtraPayloadFields
    ) {
      return res.status(400).json({
        error: "downloadSizeMb is only supported for DOWNLOAD_DATA commands"
      });
    }

    let normalizedEnabled;
    let normalizedAutoHangupSeconds;
    if (isAutoAnswerCommand) {
      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          error: "enabled is required and must be a boolean for AUTO_ANSWER commands"
        });
      }

      normalizedEnabled = enabled;
      if (
        enabled === true &&
        autoHangupSeconds !== undefined &&
        autoHangupSeconds !== null
      ) {
        const parsedAutoHangupSeconds = Number(autoHangupSeconds);
        if (!Number.isFinite(parsedAutoHangupSeconds) || parsedAutoHangupSeconds <= 0) {
          return res.status(400).json({
            error: "autoHangupSeconds must be a number greater than 0"
          });
        }

        normalizedAutoHangupSeconds = Math.max(
          1,
          Math.min(600, Math.round(parsedAutoHangupSeconds))
        );
      }
    } else {
      if (enabled !== undefined && enabled !== null && !allowsExtraPayloadFields) {
        return res.status(400).json({
          error: "enabled is only supported for AUTO_ANSWER commands"
        });
      }
      if (
        autoHangupSeconds !== undefined &&
        autoHangupSeconds !== null &&
        !allowsExtraPayloadFields
      ) {
        return res.status(400).json({
          error: "autoHangupSeconds is only supported for AUTO_ANSWER commands"
        });
      }
    }

    if (scheduledAt) {
      const parsedDate = parseScheduledAtAsRiyadhToUtcDate(scheduledAt);
      const parsedTime = parsedDate.getTime();

      if (Number.isNaN(parsedTime)) {
        return res.status(400).json({ error: "Invalid scheduledAt date" });
      }

      const now = Date.now();
      const diff = parsedTime - now;

      if (diff < -60000) {
        return res.status(400).json({ error: "scheduledAt is too far in the past" });
      }

      if (diff > 0) {
        scheduledAtDate = parsedDate;
      }
    }

    const commandData = {
      deviceUid: normalizedDeviceUid,
      action: normalizedAction,
      type: commandType,
      status: "pending",
      isImmediate: scheduledAtDate === null,
      createdAt: new Date(toUtcISOString())
    };

    addIfPresent(commandData, "scheduledAt", scheduledAtDate);
    addIfPresent(commandData, "notes", normalizedNotes);

    if (normalizedAction === "call") {
      addIfPresent(commandData, "phoneNumber", normalizedPhoneNumber);
      addIfPresent(commandData, "durationSeconds", normalizedDurationSeconds);
    } else if (normalizedAction === "sms") {
      addIfPresent(commandData, "phoneNumber", normalizedPhoneNumber);
      addIfPresent(commandData, "message", normalizedMessage);
    } else if (normalizedAction === "open_url") {
      addIfPresent(commandData, "url", normalizedUrl);
    } else if (normalizedAction === "open_app") {
      addIfPresent(commandData, "appName", normalizedAppName);
      addIfPresent(commandData, "resolvedPackageName", normalizedResolvedPackageName);
    } else if (normalizedAction === "auto_answer") {
      addIfPresent(commandData, "enabled", normalizedEnabled);
      if (normalizedEnabled === true) {
        addIfPresent(commandData, "autoHangupSeconds", normalizedAutoHangupSeconds);
      }
    } else if (normalizedAction === "download_data") {
      addIfPresent(commandData, "downloadSizeMb", normalizedDownloadSizeMb);
    }

    const command = await Command.create(commandData);

    logCommandLifecycle("created", {
      commandId: commandIdFrom(command),
      deviceUid: normalizedDeviceUid,
      oldStatus: null,
      newStatus: "pending",
      details: {
        action: normalizedAction,
        type: commandType,
        url: isOpenUrlCommand ? normalizedUrl : null,
        appName: isOpenAppCommand ? normalizedAppName : null,
        resolvedPackageName: isOpenAppCommand ? normalizedResolvedPackageName : null,
        downloadSizeMb: isDownloadDataCommand ? normalizedDownloadSizeMb : null,
        scheduledAt: scheduledAtDate ? scheduledAtDate.toISOString() : null
      }
    });

    if (isOpenAppCommand) {
      logOpenAppResolver({
        commandId: commandIdFrom(command),
        deviceUid: normalizedDeviceUid,
        appName: normalizedAppName,
        normalizedAppName,
        resolvedPackageName: normalizedResolvedPackageName,
        matchedAlias: openAppResolution?.matchedAlias ?? null,
        usedFallback: openAppResolution?.usedFallback ?? null
      });
    }
    if (isReturnToAutoCallCommand) {
      logReturnToAutoCallEvent({
        stage: "created",
        commandId: commandIdFrom(command),
        deviceUid: normalizedDeviceUid,
        status: "pending"
      });
    }

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands");
  }
});

// =====================
// Claim next command (atomic pending -> executing)
// =====================
app.post("/commands/claim", requireAuthenticatedDevice, async (req, res) => {
  try {
    const normalizedDeviceUid = req.deviceUid;
    if (!normalizedDeviceUid) {
      return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
    }

    const claimFilter = buildDuePendingCommandFilter(normalizedDeviceUid);
    const claimedCommand = await Command.findOneAndUpdate(
      claimFilter,
      {
        $set: {
          status: "executing"
        },
        $unset: {
          failureReason: 1,
          executedAt: 1,
          downloadDurationSeconds: 1
        }
      },
      {
        sort: COMMAND_CLAIM_SORT,
        new: true
      }
    );

    if (!claimedCommand) {
      logCommandLifecycle("claim_none", {
        deviceUid: normalizedDeviceUid,
        oldStatus: "pending",
        newStatus: null
      });
      return res.json({ success: true, command: null });
    }

    logCommandLifecycle("claimed", {
      commandId: commandIdFrom(claimedCommand),
      deviceUid: normalizedDeviceUid,
      oldStatus: "pending",
      newStatus: "executing",
      details: {
        action: claimedCommand.action,
        type: claimedCommand.type
      }
    });
    if (claimedCommand.action === "return_to_autocall") {
      logReturnToAutoCallEvent({
        stage: "claimed",
        commandId: commandIdFrom(claimedCommand),
        deviceUid: normalizedDeviceUid,
        status: "executing"
      });
    }

    return res.json({
      success: true,
      command: mapCommandForResponse(claimedCommand)
    });
  } catch (error) {
    return handleServerError(res, error, "POST /commands/claim");
  }
});

// =====================
// Get commands
// =====================
app.get("/commands", requireAuth, async (req, res) => {
  try {
    const { deviceUid, status } = req.query;
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const last24HoursCutoff = getCommandFetchCutoffDate();
    const filter = {};
    if (deviceUid) {
      const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
      if (!normalizedDeviceUid) {
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }

      const targetDevice = await Device.findOne({ deviceUid: normalizedDeviceUid });
      if (!targetDevice) {
        return res.status(404).json({ error: "Device not found" });
      }

      if (!targetDevice.ownerUserId) {
        return res.status(403).json({ error: "Device is not claimed" });
      }

      if (!isDeviceOwnedByUser(targetDevice, currentUserId)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      filter.deviceUid = normalizedDeviceUid;
    } else {
      const ownedDeviceUids = await Device.find({
        ownerUserId: currentUserId,
        deviceUid: { $regex: DEVICE_UID_REGEX }
      }).distinct("deviceUid");

      if (!ownedDeviceUids.length) {
        return res.json([]);
      }

      filter.deviceUid = { $in: ownedDeviceUids };
    }

    if (status) {
      filter.status = status;
    }

    filter.createdAt = { $gte: last24HoursCutoff };

    const result = await Command.find(filter);

    const sortedResult = [...result].sort((a, b) => {
      const aImmediate = !a.scheduledAt;
      const bImmediate = !b.scheduledAt;

      if (aImmediate && !bImmediate) return -1;
      if (!aImmediate && bImmediate) return 1;
      if (aImmediate && bImmediate) return 0;

      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    logCommandLifecycle("fetched", {
      deviceUid: typeof filter.deviceUid === "string" ? filter.deviceUid : null,
      oldStatus: null,
      newStatus: status ?? null,
      count: sortedResult.length,
      ids: sortedResult.map((command) => commandIdFrom(command))
    });

    return res.json(sortedResult.map(mapCommandForResponse));
  } catch (error) {
    return handleServerError(res, error, "GET /commands");
  }
});

app.delete("/commands", requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const ownedDeviceUids = await Device.find({
      ownerUserId: currentUserId,
      deviceUid: { $regex: DEVICE_UID_REGEX }
    }).distinct("deviceUid");

    if (!ownedDeviceUids.length) {
      return res.json({
        success: true,
        message: "All your commands cleared",
        deletedCount: 0
      });
    }

    const deletionResult = await Command.deleteMany({ deviceUid: { $in: ownedDeviceUids } });

    return res.json({
      success: true,
      message: "All your commands cleared",
      deletedCount: Number(deletionResult?.deletedCount || 0)
    });
  } catch (error) {
    return handleServerError(res, error, "DELETE /commands");
  }
});

// =====================
// Update command status
// =====================
app.post("/commands/:id/status", requireAuthenticatedDevice, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, failureReason, downloadDurationSeconds } = req.body;

    const command = mongoose.isValidObjectId(id)
      ? await Command.findById(id)
      : null;

    if (!command) {
      logCommandLifecycle("status_update_missing_command", {
        commandId: id,
        oldStatus: null,
        newStatus: status ?? null
      });
      return res.status(404).json({ error: "Command not found" });
    }

    const authenticatedDeviceUid = req.deviceUid;
    if (!authenticatedDeviceUid || command.deviceUid !== authenticatedDeviceUid) {
      logSecurityEvent("command_status_update_forbidden_device_mismatch", {
        ip: req.ip,
        path: req.originalUrl,
        method: req.method,
        commandId: id,
        deviceUid: authenticatedDeviceUid ?? null,
        commandDeviceUid: command.deviceUid ?? null
      });
      return res.status(403).json({ error: "Forbidden" });
    }

    const normalizedStatus =
      typeof status === "string" ? status.trim().toLowerCase() : "";
    const validStatuses = new Set(["pending", "executing", "executed", "failed"]);

    if (!validStatuses.has(normalizedStatus)) {
      return res.status(400).json({
        error: "Invalid status. Only 'pending', 'executing', 'executed', and 'failed' are supported."
      });
    }

    const allowedTransitions = {
      pending: new Set(["pending", "executing", "executed", "failed"]),
      executing: new Set(["executing", "executed", "failed"]),
      executed: new Set(["executed"]),
      failed: new Set(["failed"])
    };

    const canTransition = allowedTransitions[command.status]?.has(normalizedStatus);
    if (!canTransition) {
      logCommandLifecycle("status_transition_ignored", {
        commandId: commandIdFrom(command),
        deviceUid: command.deviceUid,
        oldStatus: command.status,
        newStatus: normalizedStatus
      });
      return res.json(mapCommandForResponse(command));
    }

    const previousStatus = command.status;
    command.status = normalizedStatus;
    const isDownloadDataCommand =
      command.action === "download_data" || command.type === "DOWNLOAD_DATA";

    if (normalizedStatus === "executed") {
      if (isDownloadDataCommand) {
        const parsedDownloadDurationSeconds = Number(downloadDurationSeconds);
        if (
          !Number.isFinite(parsedDownloadDurationSeconds) ||
          parsedDownloadDurationSeconds <= 0
        ) {
          return res.status(400).json({
            error:
              "downloadDurationSeconds is required and must be a number greater than 0 for DOWNLOAD_DATA when status is executed"
          });
        }
        command.downloadDurationSeconds = Math.round(parsedDownloadDurationSeconds);
      } else {
        unsetIfPresent(command, "downloadDurationSeconds");
      }
      command.executedAt = new Date(toUtcISOString());
      unsetIfPresent(command, "failureReason");
    } else if (normalizedStatus === "failed") {
      const normalizedFailureReason =
        typeof failureReason === "string" ? failureReason.trim() : "";
      if (normalizedFailureReason) {
        command.failureReason = normalizedFailureReason;
      } else {
        unsetIfPresent(command, "failureReason");
      }
      unsetIfPresent(command, "downloadDurationSeconds");
    } else {
      unsetIfPresent(command, "failureReason");
      unsetIfPresent(command, "downloadDurationSeconds");
    }

    await command.save();

    logCommandLifecycle("status_updated", {
      commandId: commandIdFrom(command),
      deviceUid: command.deviceUid,
      oldStatus: previousStatus,
      newStatus: normalizedStatus,
      details: {
        failureReason:
          normalizedStatus === "failed"
            ? command.failureReason ?? null
            : null,
        downloadDurationSeconds:
          normalizedStatus === "executed" && isDownloadDataCommand
            ? command.downloadDurationSeconds ?? null
            : null
      }
    });
    if (command.action === "return_to_autocall") {
      logReturnToAutoCallEvent({
        stage: "status_updated",
        commandId: commandIdFrom(command),
        deviceUid: command.deviceUid,
        status: normalizedStatus,
        failureReason: normalizedStatus === "failed" ? command.failureReason ?? null : null
      });
    }

    return res.json(mapCommandForResponse(command));
  } catch (error) {
    return handleServerError(res, error, "POST /commands/:id/status");
  }
});

app.use(express.static("public"));
app.use((error, req, res, next) => {
  console.error("[ExpressError]", error);
  if (res.headersSent) {
    return next(error);
  }

  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const statusCode = Number(error?.status || error?.statusCode) || 500;
  return res.status(statusCode).json({ error: statusCode >= 500 ? "Internal server error" : error.message });
});

const PORT = Number(process.env.PORT) || 4000;

function warnIfJwtSecretMissing() {
  if (isAuthEnabled()) {
    return;
  }

  console.warn(
    "[Auth] JWT_SECRET is missing. Web auth routes (/auth/*) and protected web endpoints are disabled and will return a clear error until JWT_SECRET is configured."
  );
}

function warnIfLegacyDeviceAuthFallbackEnabled() {
  if (!DEVICE_AUTH_ALLOW_LEGACY_FALLBACK) {
    return;
  }

  console.warn(
    "[DeviceAuth] DEVICE_AUTH_ALLOW_LEGACY_FALLBACK=true. Legacy untokened device requests are temporarily allowed on protected device endpoints."
  );
}

async function cleanupLegacyDeviceUidData() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const invalidUidFilter = { deviceUid: { $not: DEVICE_UID_REGEX } };
  const [devicesCleanupResult, commandsCleanupResult] = await Promise.all([
    Device.deleteMany(invalidUidFilter),
    Command.deleteMany(invalidUidFilter)
  ]);

  const deletedDevices = Number(devicesCleanupResult?.deletedCount || 0);
  const deletedCommands = Number(commandsCleanupResult?.deletedCount || 0);
  if (deletedDevices > 0 || deletedCommands > 0) {
    console.warn("[DeviceUidCleanup] Removed legacy rows with invalid deviceUid:", {
      deletedDevices,
      deletedCommands
    });
  }
}

async function startServer() {
  warnIfJwtSecretMissing();
  warnIfLegacyDeviceAuthFallbackEnabled();

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  await connectToDatabase();
  await cleanupLegacyDeviceUidData();
}

startServer();
