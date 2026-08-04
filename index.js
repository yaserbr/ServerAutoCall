require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { Server: SocketIOServer } = require("socket.io");

const { connectToDatabase } = require("./src/config/db");
const Device = require("./src/models/Device");
const Command = require("./src/models/Command");
const PairingToken = require("./src/models/PairingToken");
const User = require("./src/models/User");
const Contact = require("./src/models/Contact");
const { requireAuth } = require("./src/middleware/requireAuth");
const {
  buildRequireDeviceAuth,
  extractDeviceTokenFromRequest
} = require("./src/middleware/requireDeviceAuth");
const {
  issueDeviceTokenForDevice,
  isDeviceTokenMatch,
  hashDeviceToken
} = require("./src/auth/deviceToken");
const {
  ADMIN_SETUP_KEY_MIN_BYTES,
  JWT_SECRET_MIN_BYTES,
  clearAccessTokenCookie,
  getAdminSetupKey,
  getAdminSetupKeyConfigurationIssue,
  getJwtSecret,
  getJwtSecretConfigurationIssue,
  isSecretEqual,
  setAccessTokenCookie,
  signAccessToken
} = require("./src/auth/accessToken");
const { sanitizeRequestBody } = require("./src/security/requestSanitizer");
const {
  agentRateLimiter,
  authRateLimiter,
  commandRateLimiter,
  deviceRateLimiter,
  dummyDownloadRateLimiter
} = require("./src/security/rateLimits");
const { getSafeRequestPath, logSecurityEvent } = require("./src/security/auditLogger");
const {
  buildSocketCorsOptions,
  createExpressCorsMiddleware,
  getConfiguredAllowedOrigins,
  isRequestOriginAllowed
} = require("./src/security/corsPolicy");
const { ensureDeviceOwnershipEpoch } = require("./src/security/deviceOwnership");
const { safeErrorMetadata } = require("./src/security/safeError");
const {
  createSocketAuthMiddleware,
  isDashboardSocket,
  isDeviceSocket,
  resolveAuthenticatedDeviceUidFromSocket,
  canDashboardJoinDevice
} = require("./src/socket/auth");
const { runAgentOrchestrator } = require("./src/services/agentService");
const CommandCollectionService = require("./src/services/commandCollectionService");
const {
  reserveAuthorizedDummyDownload
} = require("./src/services/downloadGuardService");
const CollectionTemplate = require("./src/models/CollectionTemplate");
const { hasPresentValue, addIfPresent, unsetIfPresent, toPlainObject, commandIdFrom } = require("./src/utils/objects");
const createAuthRouter = require("./src/routes/auth");
const createDevicesRouter = require("./src/routes/devices");
const createCommandsRouter = require("./src/routes/commands");
const {
  DEVICE_UID_REGEX,
  DEVICE_UID_FORMAT_ERROR,
  normalizeDeviceUid
} = require("./src/domain/deviceUid");
const { COMMAND_ACTION_TO_TYPE } = require("./src/domain/commandTypes");

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: buildSocketCorsOptions(),
  allowRequest: (req, callback) => {
    const allowed = isRequestOriginAllowed(
      req.headers?.origin,
      req,
      getConfiguredAllowedOrigins()
    );
    if (!allowed) {
      logSecurityEvent("socket_origin_rejected", {
        ip: req.socket?.remoteAddress,
        path: req.url
      });
    }
    callback(null, allowed);
  }
});

app.set("trust proxy", 1);

process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", safeErrorMetadata(error));
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", safeErrorMetadata(reason));
});

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${getSafeRequestPath(req.url)}`);
  next();
});

app.use(createExpressCorsMiddleware(cors, logSecurityEvent));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "http://localhost:4000", "ws://localhost:4000"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        scriptSrcElem: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
      }
    },
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
    console.log(
      `[HTTP] ${req.method} ${getSafeRequestPath(req.originalUrl)} -> ${res.statusCode} (${durationMs}ms)`
    );
  });
  next();
});

app.use("/auth", authRateLimiter);
app.use("/commands", commandRateLimiter);
app.use("/devices", deviceRateLimiter);
app.use("/agent", agentRateLimiter);

const RIYADH_TIMEZONE = "Asia/Riyadh";
const RIYADH_UTC_OFFSET_MINUTES = 3 * 60;
const DEVICE_NAME_MAX_LENGTH = 60;
const COMMAND_FETCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SCHEDULED_COMMAND_SYNC = 100;
const COMMAND_DUPLICATE_GUARD_WINDOW_MS = (() => {
  const parsed = Number(process.env.COMMAND_DUPLICATE_GUARD_WINDOW_MS);
  if (!Number.isFinite(parsed)) return 3000;
  const normalized = Math.round(parsed);
  return Math.max(0, normalized);
})();
const COMMAND_DUPLICATE_EXCLUDED_ACTIONS = new Set(["screen_touch", "screen_swipe"]);
const BCRYPT_SALT_ROUNDS = 10;
const COMMAND_CLAIM_SORT = { isImmediate: -1, scheduledAt: 1, createdAt: 1, _id: 1 };
const DUMMY_DOWNLOAD_MIN_MB = 10;
const DUMMY_DOWNLOAD_MAX_MB = 1000;
const DUMMY_DOWNLOAD_CHUNK_BYTES = 64 * 1024;
const ESIM_ACTIVATION_CODE_MAX_LENGTH = 512;
const AGENT_MESSAGE_MAX_LENGTH = 2000;
const AGENT_HISTORY_MAX_ITEMS = 20;
const AGENT_HISTORY_ITEM_MAX_LENGTH = 2000;
const REMOTE_TOUCH_MAX_COORDINATE = 20000;
const REMOTE_TOUCH_MAX_DURATION_MS = 10000;
const REMOTE_TOUCH_MIN_DURATION_MS = 50;
const PAIRING_TOKEN_BYTES = 32;
const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
const PAIRING_TOKEN_TYPE = "AUTOCALL_PAIRING";
const MANUAL_PAIRING_CODE_LENGTH = 6;
const MANUAL_PAIRING_CODE_REGEX = new RegExp(`^\\d{${MANUAL_PAIRING_CODE_LENGTH}}$`);
const PAIRING_TOKEN_GENERATION_MAX_ATTEMPTS = 10;
const PAIRING_TOKEN_EXPIRY_CLEANUP_INTERVAL_MS = 60 * 1000;
const SCREEN_MIRROR_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PUBLIC_SERVER_URL = "https://autocall--serverautocall--yh4cgzrdywjc.code.run";
const OPEN_APP_PACKAGE_REGEX = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/;
const screenMirrorSessions = new Map();
const screenMirrorViewerDeviceBySocketId = new Map();
const activeDeviceSocketIdsByUid = new Map();
const deviceUidBySocketId = new Map();
const pairingTokenMemoryStore = new Map();
const requireAuthenticatedDevice = buildRequireDeviceAuth();
const OPEN_APP_ALIAS_DEFINITIONS = [
  {
    packageName: "com.android.settings",
    aliases: [
      "settings",
      "android settings",
      "system settings",
      "phone settings",
      "الإعدادات",
      "اعدادات"
    ]
  },
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

function normalizeServerBaseUrl(value) {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return null;
  return normalized.replace(/\/+$/, "");
}

function resolvePublicServerUrl(req) {
  const configuredServerUrl = normalizeServerBaseUrl(process.env.PUBLIC_SERVER_URL);
  if (configuredServerUrl) {
    return configuredServerUrl;
  }

  const forwardedHostHeader = req.headers?.["x-forwarded-host"];
  const resolvedHost =
    typeof forwardedHostHeader === "string" && forwardedHostHeader.trim()
      ? forwardedHostHeader.split(",")[0].trim()
      : typeof req.headers?.host === "string" && req.headers.host.trim()
        ? req.headers.host.trim()
        : "";

  const forwardedProtoHeader = req.headers?.["x-forwarded-proto"];
  const resolvedProtocol =
    typeof forwardedProtoHeader === "string" && forwardedProtoHeader.trim()
      ? forwardedProtoHeader.split(",")[0].trim().toLowerCase()
      : typeof req.protocol === "string" && req.protocol.trim()
        ? req.protocol.trim().toLowerCase()
        : "";

  if (resolvedHost && (resolvedProtocol === "http" || resolvedProtocol === "https")) {
    return `${resolvedProtocol}://${resolvedHost}`;
  }

  if (resolvedHost) {
    return `${req.secure ? "https" : "http"}://${resolvedHost}`;
  }

  return DEFAULT_PUBLIC_SERVER_URL;
}

function normalizePairingToken(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeManualPairingCode(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return MANUAL_PAIRING_CODE_REGEX.test(normalized) ? normalized : "";
}

function generatePairingToken() {
  return crypto.randomBytes(PAIRING_TOKEN_BYTES).toString("hex");
}

function generateManualPairingCode() {
  const max = 10 ** MANUAL_PAIRING_CODE_LENGTH;
  const value = crypto.randomInt(0, max);
  return String(value).padStart(MANUAL_PAIRING_CODE_LENGTH, "0");
}

function hashPairingToken(token) {
  const normalizedToken = normalizePairingToken(token);
  if (!normalizedToken) return "";
  return crypto.createHash("sha256").update(normalizedToken).digest("hex");
}

function hashManualPairingCode(code) {
  const normalizedCode = normalizeManualPairingCode(code);
  if (!normalizedCode) return "";
  return crypto.createHash("sha256").update(normalizedCode).digest("hex");
}

function buildPairingTokenExpiryDate() {
  return new Date(Date.now() + PAIRING_TOKEN_TTL_MS);
}

function cleanupExpiredPairingTokensInMemory(nowMs = Date.now()) {
  for (const [tokenHash, record] of pairingTokenMemoryStore.entries()) {
    if (!record || typeof record !== "object") {
      pairingTokenMemoryStore.delete(tokenHash);
      continue;
    }

    const expiresAtMs = Number(record.expiresAtMs || 0);
    const isUsed = record.used === true;
    if (!expiresAtMs || expiresAtMs <= nowMs || isUsed) {
      pairingTokenMemoryStore.delete(tokenHash);
    }
  }
}

function translatePairingTokenReasonToCodeReason(reason) {
  if (reason === "missing_pairing_token") return "missing_pairing_code";
  if (reason === "invalid_pairing_token") return "invalid_pairing_code";
  if (reason === "pairing_token_used") return "pairing_code_used";
  if (reason === "pairing_token_expired") return "pairing_code_expired";
  return reason;
}

function getPairingCredentialFailureHttpStatus(reason) {
  if (reason === "missing_pairing_token") return 400;
  if (reason === "missing_pairing_code") return 400;
  if (reason === "missing_pairing_credential") return 400;
  if (reason === "invalid_pairing_token") return 404;
  if (reason === "invalid_pairing_code") return 404;
  if (reason === "pairing_token_used") return 409;
  if (reason === "pairing_code_used") return 409;
  if (reason === "pairing_token_expired") return 410;
  if (reason === "pairing_code_expired") return 410;
  return 400;
}

function getPairingCredentialFailureMessage(reason) {
  if (reason === "missing_pairing_token") return "pairingToken is required";
  if (reason === "missing_pairing_code") return "pairingCode is required";
  if (reason === "missing_pairing_credential") return "pairingToken or pairingCode is required";
  if (reason === "invalid_pairing_token") return "Invalid pairing token";
  if (reason === "invalid_pairing_code") return "Invalid pairing code";
  if (reason === "pairing_token_used") return "Pairing token already used";
  if (reason === "pairing_code_used") return "Pairing code already used";
  if (reason === "pairing_token_expired") return "Pairing token expired";
  if (reason === "pairing_code_expired") return "Pairing code expired";
  return "Invalid pairing token";
}

function getPairingCredentialFailureMessageForType(reason, credentialType = "token") {
  if (credentialType === "code") {
    return getPairingCredentialFailureMessage(translatePairingTokenReasonToCodeReason(reason));
  }
  return getPairingCredentialFailureMessage(reason);
}

async function createPairingTokenForUser(userId) {
  const expiresAt = buildPairingTokenExpiryDate();
  const now = new Date(toUtcISOString());

  if (mongoose.connection.readyState === 1) {
    for (let attempt = 0; attempt < PAIRING_TOKEN_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const pairingToken = generatePairingToken();
      const tokenHash = hashPairingToken(pairingToken);
      const manualPairingCode = generateManualPairingCode();
      const manualCodeHash = hashManualPairingCode(manualPairingCode);

      try {
        await PairingToken.create({
          tokenHash,
          manualCodeHash,
          userId,
          expiresAt,
          used: false,
          usedAt: null,
          usedByDeviceUid: null
        });

        return {
          pairingToken,
          manualPairingCode,
          expiresAt
        };
      } catch (error) {
        if (error?.code === 11000 && attempt < PAIRING_TOKEN_GENERATION_MAX_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }
  } else {
    cleanupExpiredPairingTokensInMemory(now.getTime());

    for (let attempt = 0; attempt < PAIRING_TOKEN_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      const pairingToken = generatePairingToken();
      const tokenHash = hashPairingToken(pairingToken);
      const manualPairingCode = generateManualPairingCode();
      const manualCodeHash = hashManualPairingCode(manualPairingCode);
      const hasManualCodeCollision = Array.from(pairingTokenMemoryStore.values()).some(
        (record) => record?.manualCodeHash === manualCodeHash
      );

      if (pairingTokenMemoryStore.has(tokenHash) || hasManualCodeCollision) {
        continue;
      }

      pairingTokenMemoryStore.set(tokenHash, {
        userId: String(userId),
        expiresAtMs: expiresAt.getTime(),
        manualCodeHash,
        used: false,
        usedAtMs: null,
        usedByDeviceUid: null
      });

      return {
        pairingToken,
        manualPairingCode,
        expiresAt
      };
    }
  }

  throw new Error("Unable to generate secure pairing token");
}

async function inspectPairingToken(pairingTokenValue) {
  const normalizedPairingToken = normalizePairingToken(pairingTokenValue);
  if (!normalizedPairingToken) {
    return {
      ok: false,
      reason: "missing_pairing_token",
      tokenHash: "",
      userId: ""
    };
  }

  const tokenHash = hashPairingToken(normalizedPairingToken);
  if (!tokenHash) {
    return {
      ok: false,
      reason: "invalid_pairing_token",
      tokenHash: "",
      userId: ""
    };
  }

  const now = new Date(toUtcISOString());

  if (mongoose.connection.readyState === 1) {
    const record = await PairingToken.findOne({ tokenHash }).select(
      "_id userId expiresAt used"
    );
    if (!record) {
      return {
        ok: false,
        reason: "invalid_pairing_token",
        tokenHash,
        userId: ""
      };
    }

    if (record.used) {
      return {
        ok: false,
        reason: "pairing_token_used",
        tokenHash,
        userId: String(record.userId || "")
      };
    }

    const expiresAtMs = Number(new Date(record.expiresAt).getTime());
    if (!expiresAtMs || expiresAtMs <= now.getTime()) {
      return {
        ok: false,
        reason: "pairing_token_expired",
        tokenHash,
        userId: String(record.userId || "")
      };
    }

    return {
      ok: true,
      reason: "ok",
      tokenHash,
      userId: String(record.userId || ""),
      expiresAt: new Date(expiresAtMs)
    };
  }

  cleanupExpiredPairingTokensInMemory(now.getTime());
  const memoryRecord = pairingTokenMemoryStore.get(tokenHash);
  if (!memoryRecord) {
    return {
      ok: false,
      reason: "invalid_pairing_token",
      tokenHash,
      userId: ""
    };
  }

  if (memoryRecord.used === true) {
    pairingTokenMemoryStore.delete(tokenHash);
    return {
      ok: false,
      reason: "pairing_token_used",
      tokenHash,
      userId: String(memoryRecord.userId || "")
    };
  }

  const expiresAtMs = Number(memoryRecord.expiresAtMs || 0);
  if (!expiresAtMs || expiresAtMs <= now.getTime()) {
    pairingTokenMemoryStore.delete(tokenHash);
    return {
      ok: false,
      reason: "pairing_token_expired",
      tokenHash,
      userId: String(memoryRecord.userId || "")
    };
  }

  return {
    ok: true,
    reason: "ok",
    tokenHash,
    userId: String(memoryRecord.userId || ""),
    expiresAt: new Date(expiresAtMs)
  };
}

async function inspectPairingCode(pairingCodeValue) {
  const normalizedPairingCode = normalizeManualPairingCode(pairingCodeValue);
  if (!normalizedPairingCode) {
    return {
      ok: false,
      reason: "missing_pairing_code",
      tokenHash: "",
      userId: ""
    };
  }

  const manualCodeHash = hashManualPairingCode(normalizedPairingCode);
  if (!manualCodeHash) {
    return {
      ok: false,
      reason: "invalid_pairing_code",
      tokenHash: "",
      userId: ""
    };
  }

  const now = new Date(toUtcISOString());

  if (mongoose.connection.readyState === 1) {
    const records = await PairingToken.find({ manualCodeHash })
      .select("_id tokenHash userId expiresAt used createdAt")
      .sort({ createdAt: -1 })
      .limit(2);

    if (!records || records.length === 0) {
      return {
        ok: false,
        reason: "invalid_pairing_code",
        tokenHash: "",
        userId: ""
      };
    }

    if (records.length > 1) {
      return {
        ok: false,
        reason: "invalid_pairing_code",
        tokenHash: "",
        userId: ""
      };
    }

    const record = records[0];
    if (record.used) {
      return {
        ok: false,
        reason: "pairing_code_used",
        tokenHash: String(record.tokenHash || ""),
        userId: String(record.userId || "")
      };
    }

    const expiresAtMs = Number(new Date(record.expiresAt).getTime());
    if (!expiresAtMs || expiresAtMs <= now.getTime()) {
      return {
        ok: false,
        reason: "pairing_code_expired",
        tokenHash: String(record.tokenHash || ""),
        userId: String(record.userId || "")
      };
    }

    return {
      ok: true,
      reason: "ok",
      tokenHash: String(record.tokenHash || ""),
      userId: String(record.userId || ""),
      expiresAt: new Date(expiresAtMs)
    };
  }

  cleanupExpiredPairingTokensInMemory(now.getTime());
  const matches = [];
  for (const [tokenHash, record] of pairingTokenMemoryStore.entries()) {
    if (record?.manualCodeHash === manualCodeHash) {
      matches.push({ tokenHash, record });
      if (matches.length > 1) {
        break;
      }
    }
  }

  if (matches.length !== 1) {
    return {
      ok: false,
      reason: "invalid_pairing_code",
      tokenHash: "",
      userId: ""
    };
  }

  const match = matches[0];
  const memoryRecord = match.record;
  if (memoryRecord.used === true) {
    pairingTokenMemoryStore.delete(match.tokenHash);
    return {
      ok: false,
      reason: "pairing_code_used",
      tokenHash: match.tokenHash,
      userId: String(memoryRecord.userId || "")
    };
  }

  const expiresAtMs = Number(memoryRecord.expiresAtMs || 0);
  if (!expiresAtMs || expiresAtMs <= now.getTime()) {
    pairingTokenMemoryStore.delete(match.tokenHash);
    return {
      ok: false,
      reason: "pairing_code_expired",
      tokenHash: match.tokenHash,
      userId: String(memoryRecord.userId || "")
    };
  }

  return {
    ok: true,
    reason: "ok",
    tokenHash: match.tokenHash,
    userId: String(memoryRecord.userId || ""),
    expiresAt: new Date(expiresAtMs)
  };
}

async function inspectPairingCredential(pairingTokenValue, pairingCodeValue) {
  const normalizedPairingToken = normalizePairingToken(pairingTokenValue);
  if (normalizedPairingToken) {
    const inspection = await inspectPairingToken(normalizedPairingToken);
    return {
      ...inspection,
      credentialType: "token"
    };
  }

  const normalizedPairingCode = normalizeManualPairingCode(pairingCodeValue);
  if (normalizedPairingCode) {
    const inspection = await inspectPairingCode(normalizedPairingCode);
    return {
      ...inspection,
      credentialType: "code"
    };
  }

  return {
    ok: false,
    reason: "missing_pairing_credential",
    tokenHash: "",
    userId: "",
    credentialType: "token"
  };
}

async function consumePairingTokenByHash(tokenHash, usedByDeviceUid) {
  const normalizedTokenHash = typeof tokenHash === "string" ? tokenHash.trim().toLowerCase() : "";
  if (!normalizedTokenHash) {
    return {
      ok: false,
      reason: "invalid_pairing_token"
    };
  }

  const normalizedUsedByDeviceUid = normalizeDeviceUid(usedByDeviceUid);
  const now = new Date(toUtcISOString());

  if (mongoose.connection.readyState === 1) {
    const usedRecord = await PairingToken.findOneAndUpdate(
      {
        tokenHash: normalizedTokenHash,
        used: false,
        expiresAt: { $gt: now }
      },
      {
        $set: {
          used: true,
          usedAt: now,
          usedByDeviceUid: normalizedUsedByDeviceUid || null
        }
      },
      {
        new: true
      }
    ).select("_id userId");

    if (!usedRecord) {
      const inspected = await PairingToken.findOne({ tokenHash: normalizedTokenHash }).select(
        "used expiresAt userId"
      );
      if (!inspected) {
        return {
          ok: false,
          reason: "invalid_pairing_token"
        };
      }
      if (inspected.used) {
        return {
          ok: false,
          reason: "pairing_token_used"
        };
      }

      const expiresAtMs = Number(new Date(inspected.expiresAt).getTime());
      if (!expiresAtMs || expiresAtMs <= now.getTime()) {
        return {
          ok: false,
          reason: "pairing_token_expired"
        };
      }

      return {
        ok: false,
        reason: "invalid_pairing_token"
      };
    }

    return {
      ok: true,
      reason: "ok",
      userId: String(usedRecord.userId || "")
    };
  }

  cleanupExpiredPairingTokensInMemory(now.getTime());
  const memoryRecord = pairingTokenMemoryStore.get(normalizedTokenHash);
  if (!memoryRecord) {
    return {
      ok: false,
      reason: "invalid_pairing_token"
    };
  }

  const expiresAtMs = Number(memoryRecord.expiresAtMs || 0);
  if (!expiresAtMs || expiresAtMs <= now.getTime()) {
    pairingTokenMemoryStore.delete(normalizedTokenHash);
    return {
      ok: false,
      reason: "pairing_token_expired"
    };
  }

  if (memoryRecord.used === true) {
    pairingTokenMemoryStore.delete(normalizedTokenHash);
    return {
      ok: false,
      reason: "pairing_token_used"
    };
  }

  memoryRecord.used = true;
  memoryRecord.usedAtMs = now.getTime();
  memoryRecord.usedByDeviceUid = normalizedUsedByDeviceUid || null;
  pairingTokenMemoryStore.set(normalizedTokenHash, memoryRecord);

  return {
    ok: true,
    reason: "ok",
    userId: String(memoryRecord.userId || "")
  };
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

function parseNonNegativeCoordinate(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed < 0 || parsed > REMOTE_TOUCH_MAX_COORDINATE) {
    return null;
  }

  return parsed;
}

function parsePositiveDimension(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed <= 0 || parsed > REMOTE_TOUCH_MAX_COORDINATE) {
    return null;
  }

  return parsed;
}

function parseTouchDurationMs(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }

  if (parsed <= 0 || parsed > REMOTE_TOUCH_MAX_DURATION_MS) {
    return null;
  }

  return Math.max(REMOTE_TOUCH_MIN_DURATION_MS, parsed);
}

function parseTouchTarget(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  return ["back", "home", "recents"].includes(normalized) ? normalized : null;
}


function normalizeOptionalCommandSubscriptionId(commandLike, targetDevice) {
  if (!commandLike || typeof commandLike !== "object") {
    return { ok: true };
  }

  if (!hasPresentValue(commandLike.subscriptionId)) {
    delete commandLike.subscriptionId;
    return { ok: true };
  }

  const action = typeof commandLike.action === "string"
    ? commandLike.action.trim().toLowerCase()
    : "";
  const type = typeof commandLike.type === "string"
    ? commandLike.type.trim().toUpperCase()
    : "";
  const isCallOrSmsCommand = action === "call" || action === "sms" || type === "CALL" || type === "SMS";
  if (!isCallOrSmsCommand) {
    return {
      ok: false,
      error: "subscriptionId is only supported for CALL and SMS commands"
    };
  }

  const parsedSubscriptionId = Number(commandLike.subscriptionId);
  if (!Number.isInteger(parsedSubscriptionId) || parsedSubscriptionId < 0) {
    return {
      ok: false,
      error: "subscriptionId must be a non-negative integer"
    };
  }

  const reportedSubscriptions = Array.isArray(targetDevice?.esimSubscriptions)
    ? targetDevice.esimSubscriptions
    : [];
  if (
    reportedSubscriptions.length > 0 &&
    !reportedSubscriptions.some((profile) => Number(profile?.subscriptionId) === parsedSubscriptionId)
  ) {
    return {
      ok: false,
      error: "subscriptionId does not belong to the selected device"
    };
  }

  commandLike.subscriptionId = parsedSubscriptionId;
  return { ok: true };
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
    hasFailureReason: Boolean(payload.hasFailureReason ?? payload.failureReason)
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

function normalizeEsimSubscriptions(value) {
  if (!Array.isArray(value)) return [];

  const seenSubscriptionIds = new Set();
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const subscriptionId = Number(item.subscriptionId);
      if (!Number.isInteger(subscriptionId) || subscriptionId < 0) return null;
      if (seenSubscriptionIds.has(subscriptionId)) return null;
      seenSubscriptionIds.add(subscriptionId);

      const portIndex = Number(item.portIndex);
      const simSlotIndex = Number(item.simSlotIndex);
      const cardId = Number(item.cardId);
      const phoneNumber =
        typeof item.phoneNumber === "string" && item.phoneNumber.trim()
          ? item.phoneNumber.trim().slice(0, 40)
          : null;

      return {
        subscriptionId,
        displayName:
          typeof item.displayName === "string" ? item.displayName.trim().slice(0, 80) : "",
        carrierName:
          typeof item.carrierName === "string" ? item.carrierName.trim().slice(0, 80) : "",
        phoneNumber,
        simSlotIndex: Number.isInteger(simSlotIndex) ? simSlotIndex : null,
        isEmbedded: true,
        cardId: Number.isInteger(cardId) && cardId >= 0 ? cardId : null,
        portIndex: Number.isInteger(portIndex) && portIndex >= 0 ? portIndex : null,
        isDefaultVoice: item.isDefaultVoice === true,
        isDefaultSms: item.isDefaultSms === true,
        isDefaultData: item.isDefaultData === true
      };
    })
    .filter(Boolean)
    .slice(0, 8);
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


function getActiveDeviceSocketCount(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return 0;
  return activeDeviceSocketIdsByUid.get(normalizedDeviceUid)?.size ?? 0;
}

function isDeviceOnlineBySocket(deviceUid) {
  return getActiveDeviceSocketCount(deviceUid) > 0;
}

function registerDeviceSocketConnection(socket, deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid || !socket?.id) return 0;

  const previousDeviceUid = deviceUidBySocketId.get(socket.id);
  if (previousDeviceUid && previousDeviceUid !== normalizedDeviceUid) {
    const previousSocketIds = activeDeviceSocketIdsByUid.get(previousDeviceUid);
    if (previousSocketIds) {
      previousSocketIds.delete(socket.id);
      if (previousSocketIds.size === 0) {
        activeDeviceSocketIdsByUid.delete(previousDeviceUid);
      }
    }
    emitDevicePresenceStatus(previousDeviceUid);
  }

  let socketIds = activeDeviceSocketIdsByUid.get(normalizedDeviceUid);
  if (!socketIds) {
    socketIds = new Set();
    activeDeviceSocketIdsByUid.set(normalizedDeviceUid, socketIds);
  }
  socketIds.add(socket.id);
  deviceUidBySocketId.set(socket.id, normalizedDeviceUid);
  socket.data.commandDeviceUid = normalizedDeviceUid;
  return socketIds.size;
}

function unregisterDeviceSocketConnection(socketId) {
  const normalizedSocketId = typeof socketId === "string" ? socketId.trim() : "";
  if (!normalizedSocketId) return "";

  const deviceUid = deviceUidBySocketId.get(normalizedSocketId);
  if (!deviceUid) return "";

  deviceUidBySocketId.delete(normalizedSocketId);
  const socketIds = activeDeviceSocketIdsByUid.get(deviceUid);
  if (socketIds) {
    socketIds.delete(normalizedSocketId);
    if (socketIds.size === 0) {
      activeDeviceSocketIdsByUid.delete(deviceUid);
    }
  }

  return deviceUid;
}

function emitDevicePresenceStatus(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return;

  io.to(`dashboard:${normalizedDeviceUid}`).emit("device:presence", {
    deviceUid: normalizedDeviceUid,
    online: isDeviceOnlineBySocket(normalizedDeviceUid),
    connectedSocketCount: getActiveDeviceSocketCount(normalizedDeviceUid)
  });
}

function mapLinkedAccountForResponse(linkedAccountLike) {
  if (!linkedAccountLike) return null;

  const source = toPlainObject(linkedAccountLike);
  const resolvedIdSource =
    source?._id ??
    source?.id ??
    (typeof linkedAccountLike === "string" ? linkedAccountLike : "");
  const resolvedId = String(resolvedIdSource || "").trim();
  const resolvedUsername =
    typeof source?.username === "string" ? source.username.trim() : "";

  if (!resolvedId || !resolvedUsername) {
    return null;
  }

  return {
    id: resolvedId,
    username: resolvedUsername
  };
}

async function resolveLinkedAccountByOwnerUserId(ownerUserId) {
  const normalizedOwnerUserId = normalizeAuthUserId(String(ownerUserId || ""));
  if (!normalizedOwnerUserId) return null;

  const ownerUser = await User.findById(normalizedOwnerUserId).select("_id username");
  return mapLinkedAccountForResponse(ownerUser);
}

async function mapDeviceForResponseWithLinkedAccount(device) {
  const source = toPlainObject(device);
  const linkedAccount = await resolveLinkedAccountByOwnerUserId(source?.ownerUserId);
  return mapDeviceForResponse(source, linkedAccount);
}

async function mapDeviceListForResponseWithLinkedAccount(devices) {
  const deviceList = Array.isArray(devices) ? devices : [];
  if (deviceList.length === 0) return [];

  const ownerUserIds = Array.from(
    new Set(
      deviceList
        .map((device) => normalizeAuthUserId(String(toPlainObject(device)?.ownerUserId || "")))
        .filter(Boolean)
    )
  );

  let linkedAccountByOwnerId = new Map();
  if (ownerUserIds.length > 0) {
    const users = await User.find({ _id: { $in: ownerUserIds } }).select("_id username");
    linkedAccountByOwnerId = new Map(
      users
        .map((user) => {
          const mapped = mapLinkedAccountForResponse(user);
          return mapped ? [mapped.id, mapped] : null;
        })
        .filter(Boolean)
    );
  }

  return deviceList.map((device) => {
    const source = toPlainObject(device);
    const ownerUserId = normalizeAuthUserId(String(source?.ownerUserId || ""));
    const linkedAccount = ownerUserId ? linkedAccountByOwnerId.get(ownerUserId) ?? null : null;
    return mapDeviceForResponse(source, linkedAccount);
  });
}

function mapDeviceForResponse(device, linkedAccount) {
  const source = toPlainObject(device);
  const linkedAccountSource =
    linkedAccount === undefined
      ? source?.linkedAccount ??
        (source?.ownerUserId && typeof source.ownerUserId === "object"
          ? source.ownerUserId
          : null)
      : linkedAccount;
  const normalizedLinkedAccount = mapLinkedAccountForResponse(linkedAccountSource);

  return {
    deviceUid: source.deviceUid,
    deviceName: ensureDeviceName(source),
    platform: source.platform ?? null,
    online: isDeviceOnlineBySocket(source.deviceUid),
    lastSeen: formatUtcForRiyadhDisplay(source.lastSeen),
    linkedAccount: normalizedLinkedAccount,
    esimSubscriptions: normalizeEsimSubscriptions(source.esimSubscriptions)
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
    activationCode: source.activationCode ?? null,
    esimSubscriptionId: source.esimSubscriptionId ?? null,
    esimPortIndex: source.esimPortIndex ?? null,
    subscriptionId: source.subscriptionId ?? null,
    enabled: source.enabled ?? null,
    autoHangupSeconds: source.autoHangupSeconds ?? null,
    x: source.x ?? null,
    y: source.y ?? null,
    screenWidth: source.screenWidth ?? null,
    screenHeight: source.screenHeight ?? null,
    startX: source.startX ?? null,
    startY: source.startY ?? null,
    endX: source.endX ?? null,
    endY: source.endY ?? null,
    durationMs: source.durationMs ?? null,
    touchTarget: source.touchTarget ?? null,
    collectionId: source.collectionId ? String(source.collectionId) : null,
    collectionName: source.collectionName ?? null,
    collectionStepIndex: source.collectionStepIndex ?? null,
    collectionTotalSteps: source.collectionTotalSteps ?? null,
    status: source.status,
    failureReason: source.failureReason ?? null,
    scheduledAt: formatUtcForRiyadhDisplay(source.scheduledAt),
    scheduledAtUtc: source.scheduledAt ? new Date(source.scheduledAt).toISOString() : null,
    isImmediate:
      typeof source.isImmediate === "boolean"
        ? source.isImmediate
        : !source.scheduledAt,
    createdAt: formatUtcForRiyadhDisplay(source.createdAt),
    executedAt: formatUtcForRiyadhDisplay(source.executedAt)
  };
}

function emitCommandCreated(command, options = {}) {
  const commandResponse = mapCommandForResponse(command);
  const deviceUid = normalizeDeviceUid(commandResponse.deviceUid);
  if (!deviceUid) {
    return commandResponse;
  }

  if (options.notifyDevice !== false) {
    io.to(`device:${deviceUid}`).emit("command:new", commandResponse);
  }
  io.to(`dashboard:${deviceUid}`).emit("command:created", commandResponse);

  return commandResponse;
}

function emitCommandUpdated(command, options = {}) {
  const commandResponse = mapCommandForResponse(command);
  const deviceUid = normalizeDeviceUid(commandResponse.deviceUid);
  if (!deviceUid) {
    return commandResponse;
  }

  if (options.notifyDevice === true) {
    io.to(`device:${deviceUid}`).emit("command:updated", commandResponse);
  }
  io.to(`dashboard:${deviceUid}`).emit("command:updated", commandResponse);

  return commandResponse;
}

function emitCommandsCleared(deviceUids, deletedCount = 0) {
  const normalizedDeviceUids = [
    ...new Set(
      (Array.isArray(deviceUids) ? deviceUids : [])
        .map((deviceUid) => normalizeDeviceUid(deviceUid))
        .filter(Boolean)
    )
  ];

  if (!normalizedDeviceUids.length) {
    return;
  }

  const payload = {
    deviceUids: normalizedDeviceUids,
    deletedCount: Number(deletedCount || 0)
  };

  normalizedDeviceUids.forEach((deviceUid) => {
    io.to(`device:${deviceUid}`).emit("commands:cleared", payload);
    io.to(`dashboard:${deviceUid}`).emit("commands:cleared", payload);
  });
}

function normalizeCommandComparableString(value, options = {}) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return options.toLowerCase ? normalized.toLowerCase() : normalized;
}

function normalizeCommandComparableNumber(value) {
  if (!hasPresentValue(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCommandComparableDateToIso(value) {
  if (!value) return null;
  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return parsedDate.toISOString();
}

function buildCommandDuplicateSignature(commandLike) {
  const source = toPlainObject(commandLike) || {};

  return JSON.stringify({
    deviceUid: normalizeDeviceUid(source.deviceUid),
    action: normalizeCommandComparableString(source.action, { toLowerCase: true }),
    type: normalizeCommandComparableString(source.type),
    isImmediate: source.isImmediate === false ? false : true,
    scheduledAt: normalizeCommandComparableDateToIso(source.scheduledAt),
    phoneNumber: normalizeCommandComparableString(source.phoneNumber),
    message: normalizeCommandComparableString(source.message),
    url: normalizeCommandComparableString(source.url),
    appName: normalizeCommandComparableString(source.appName),
    resolvedPackageName: normalizeCommandComparableString(source.resolvedPackageName),
    notes: normalizeCommandComparableString(source.notes),
    durationSeconds: normalizeCommandComparableNumber(source.durationSeconds),
    downloadSizeMb: normalizeCommandComparableNumber(source.downloadSizeMb),
    activationCode: normalizeCommandComparableString(source.activationCode),
    esimSubscriptionId: normalizeCommandComparableNumber(source.esimSubscriptionId),
    esimPortIndex: normalizeCommandComparableNumber(source.esimPortIndex),
    subscriptionId: normalizeCommandComparableNumber(source.subscriptionId),
    enabled: typeof source.enabled === "boolean" ? source.enabled : null,
    autoHangupSeconds: normalizeCommandComparableNumber(source.autoHangupSeconds),
    x: normalizeCommandComparableNumber(source.x),
    y: normalizeCommandComparableNumber(source.y),
    screenWidth: normalizeCommandComparableNumber(source.screenWidth),
    screenHeight: normalizeCommandComparableNumber(source.screenHeight),
    startX: normalizeCommandComparableNumber(source.startX),
    startY: normalizeCommandComparableNumber(source.startY),
    endX: normalizeCommandComparableNumber(source.endX),
    endY: normalizeCommandComparableNumber(source.endY),
    durationMs: normalizeCommandComparableNumber(source.durationMs),
    touchTarget: normalizeCommandComparableString(source.touchTarget, { toLowerCase: true })
  });
}

function shouldApplyCommandDuplicateGuard(action) {
  return (
    typeof action === "string" &&
    action.trim() !== "" &&
    !COMMAND_DUPLICATE_EXCLUDED_ACTIONS.has(action)
  );
}

function parseUsername(rawUsername) {
  const normalized = normalizeUsername(rawUsername);
  if (!normalized) return "";
  if (normalized.length > 50) return "";
  return normalized;
}

function parsePassword(rawPassword) {
  if (typeof rawPassword !== "string") return "";
  if (rawPassword.length < 1 || rawPassword.length > 200) return "";
  return rawPassword;
}

const AGENT_COMMAND_PARAMETER_FIELDS = [
  "phoneNumber",
  "message",
  "url",
  "appName",
  "notes",
  "scheduledAt",
  "durationSeconds",
  "downloadSizeMb",
  "activationCode",
  "esimSubscriptionId",
  "esimPortIndex",
  "subscriptionId",
  "enabled",
  "autoHangupSeconds",
  "x",
  "y",
  "screenWidth",
  "screenHeight",
  "startX",
  "startY",
  "endX",
  "endY",
  "durationMs",
  "touchTarget"
];

function normalizeAgentHistory(value) {
  if (!Array.isArray(value) || value.length > AGENT_HISTORY_MAX_ITEMS) return null;

  const normalized = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const role = typeof item.role === "string" ? item.role.trim().toLowerCase() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!new Set(["user", "assistant", "model"]).has(role)) return null;
    if (!content || content.length > AGENT_HISTORY_ITEM_MAX_LENGTH) return null;
    normalized.push({ role, content });
  }
  return normalized;
}

function buildValidatedAgentCommandData(draftCommand, targetDevice, currentUserId) {
  if (!draftCommand || typeof draftCommand !== "object") return null;
  const action = typeof draftCommand.action === "string"
    ? draftCommand.action.trim().toLowerCase()
    : "";
  const type = COMMAND_ACTION_TO_TYPE[action];
  if (!type) return null;

  const commandData = {
    deviceUid: targetDevice.deviceUid,
    ownerUserId: currentUserId,
    deviceOwnershipEpoch: targetDevice.ownershipEpoch,
    action,
    type,
    status: "pending",
    isImmediate: true,
    createdAt: new Date(toUtcISOString())
  };
  for (const fieldName of AGENT_COMMAND_PARAMETER_FIELDS) {
    if (draftCommand[fieldName] !== undefined && draftCommand[fieldName] !== null) {
      commandData[fieldName] = draftCommand[fieldName];
    }
  }

  if (commandData.scheduledAt) {
    const scheduledDate = new Date(commandData.scheduledAt);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() - 60_000) {
      return null;
    }
    commandData.scheduledAt = scheduledDate;
    commandData.isImmediate = false;
  } else {
    delete commandData.scheduledAt;
  }

  if (action === "open_url") {
    const normalizedUrl = normalizeHttpUrl(commandData.url);
    if (!normalizedUrl || normalizedUrl.length > 2048) return null;
    commandData.url = normalizedUrl;
  }
  if (action === "open_app") {
    const appResolution = resolveOpenAppTarget(commandData.appName);
    if (!appResolution?.normalizedAppName || !appResolution.resolvedPackageName) return null;
    commandData.appName = appResolution.normalizedAppName;
    commandData.resolvedPackageName = appResolution.resolvedPackageName;
  }
  if (action === "download_data") {
    const parsedDownloadSizeMb = parseDownloadSizeMb(commandData.downloadSizeMb);
    if (parsedDownloadSizeMb === null) return null;
    commandData.downloadSizeMb = parsedDownloadSizeMb;
  }

  const subscriptionValidation = normalizeOptionalCommandSubscriptionId(
    commandData,
    targetDevice
  );
  return subscriptionValidation.ok ? commandData : null;
}

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPairingQrDataUrl(payload) {
  return QRCode.toDataURL(JSON.stringify(payload), {
    width: 210,
    margin: 1,
    color: {
      dark: "#052453",
      light: "#ffffff"
    }
  });
}

function parseRegistrationPassword(rawPassword) {
  if (typeof rawPassword !== "string") return "";
  if (rawPassword.length < 12 || rawPassword.length > 128) return "";
  return rawPassword;
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


function getCommandFetchCutoffDate() {
  return new Date(Date.now() - COMMAND_FETCH_WINDOW_MS);
}

function buildDuePendingCommandFilter(deviceUid, ownerUserId, deviceOwnershipEpoch) {
  return {
    deviceUid,
    ownerUserId,
    deviceOwnershipEpoch,
    status: "pending",
    createdAt: { $gte: getCommandFetchCutoffDate() },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date(toUtcISOString()) } }]
  };
}

async function listFutureScheduledCommandsForDevice(
  deviceUid,
  ownerUserId,
  deviceOwnershipEpoch
) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) {
    return { commands: [], complete: true };
  }

  const futureScheduledCommands = await Command.find({
    deviceUid: normalizedDeviceUid,
    ownerUserId,
    deviceOwnershipEpoch,
    status: "pending",
    isImmediate: false,
    createdAt: { $gte: getCommandFetchCutoffDate() },
    scheduledAt: { $gt: new Date(toUtcISOString()) }
  })
    .sort({ scheduledAt: 1, createdAt: 1, _id: 1 })
    .limit(MAX_SCHEDULED_COMMAND_SYNC + 1)
    .lean();

  const visibleScheduledCommands = futureScheduledCommands.slice(0, MAX_SCHEDULED_COMMAND_SYNC);
  return {
    commands: visibleScheduledCommands.map((command) => mapCommandForResponse(command)),
    complete: futureScheduledCommands.length <= MAX_SCHEDULED_COMMAND_SYNC
  };
}

async function claimNextPendingCommandForDevice(deviceUid, options = {}) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) {
    const error = new Error(DEVICE_UID_FORMAT_ERROR);
    error.statusCode = 400;
    throw error;
  }

  const transport = typeof options.transport === "string" ? options.transport : "unknown";
  const currentDevice = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
    "+ownershipEpoch"
  );
  if (!currentDevice?.ownerUserId) {
    return {
      success: true,
      command: null,
      scheduledCommands: [],
      scheduledCommandsComplete: true
    };
  }
  if (!(await ensureDeviceOwnershipEpoch(currentDevice))) {
    throw new Error("Device ownership state could not be initialized");
  }

  const ownerUserId = currentDevice.ownerUserId;
  const deviceOwnershipEpoch = currentDevice.ownershipEpoch;
  const claimFilter = buildDuePendingCommandFilter(
    normalizedDeviceUid,
    ownerUserId,
    deviceOwnershipEpoch
  );
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
    const scheduledCommandSync = await listFutureScheduledCommandsForDevice(
      normalizedDeviceUid,
      ownerUserId,
      deviceOwnershipEpoch
    );
    logCommandLifecycle("claim_none", {
      deviceUid: normalizedDeviceUid,
      oldStatus: "pending",
      newStatus: null,
      details: {
        transport,
        scheduledSyncCount: scheduledCommandSync.commands.length,
        scheduledSyncComplete: scheduledCommandSync.complete
      }
    });
    return {
      success: true,
      command: null,
      scheduledCommands: scheduledCommandSync.commands,
      scheduledCommandsComplete: scheduledCommandSync.complete
    };
  }

  logCommandLifecycle("claimed", {
    commandId: commandIdFrom(claimedCommand),
    deviceUid: normalizedDeviceUid,
    oldStatus: "pending",
    newStatus: "executing",
    details: {
      action: claimedCommand.action,
      type: claimedCommand.type,
      transport
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

  const scheduledCommandSync = await listFutureScheduledCommandsForDevice(
    normalizedDeviceUid,
    ownerUserId,
    deviceOwnershipEpoch
  );
  return {
    success: true,
    command: emitCommandUpdated(claimedCommand),
    scheduledCommands: scheduledCommandSync.commands,
    scheduledCommandsComplete: scheduledCommandSync.complete
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
  console.error(`[${contextLabel}]`, safeErrorMetadata(error));
  return res.status(500).json({ error: "Internal server error" });
}

function isAuthEnabled() {
  return Boolean(getJwtSecret());
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
      frameCount: 0,
      viewerCount: 0,
      width: null,
      height: null,
      fps: null,
      updatedAtMs: Date.now()
    });
  }

  return screenMirrorSessions.get(normalizedDeviceUid) ?? null;
}

function cleanupInactiveScreenMirrorSessions(nowMs = Date.now()) {
  for (const [deviceUid, session] of screenMirrorSessions.entries()) {
    const updatedAtMs = Number(session?.updatedAtMs || 0);
    const hasViewer = Number(session?.viewerCount || 0) > 0;
    const hasDeviceSocket = getActiveDeviceSocketCount(deviceUid) > 0;
    if (
      !hasViewer &&
      !hasDeviceSocket &&
      (!updatedAtMs || nowMs - updatedAtMs >= SCREEN_MIRROR_SESSION_TTL_MS)
    ) {
      screenMirrorSessions.delete(deviceUid);
    }
  }
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
    frameCount: Number(session.frameCount || 0),
    viewerCount: Number(session.viewerCount || 0),
    width: Number.isFinite(Number(session.width)) ? Number(session.width) : null,
    height: Number.isFinite(Number(session.height)) ? Number(session.height) : null,
    fps: Number.isFinite(Number(session.fps)) ? Number(session.fps) : null,
    streamMode: "webrtc"
  };
}

function emitScreenMirrorStatus(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return;

  const statusPayload = buildScreenMirrorStatus(normalizedDeviceUid);
  if (!statusPayload) return;

  io.to(`dashboard:${normalizedDeviceUid}`).emit("screen:status", statusPayload);
}

async function revokeDashboardAccessForDevice(deviceUid, allowedOwnerUserId = null) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return;

  const roomName = `dashboard:${normalizedDeviceUid}`;
  const roomSockets = await io.in(roomName).fetchSockets();
  for (const dashboardSocket of roomSockets) {
    if (!isDashboardSocket(dashboardSocket)) continue;
    const remainsAuthorized =
      allowedOwnerUserId &&
      String(dashboardSocket.data.userId || "") === String(allowedOwnerUserId);
    if (remainsAuthorized) continue;

    dashboardSocket.leave(roomName);
    if (screenMirrorViewerDeviceBySocketId.get(dashboardSocket.id) === normalizedDeviceUid) {
      screenMirrorViewerDeviceBySocketId.delete(dashboardSocket.id);
    }
    if (dashboardSocket.data.screenMirrorDashboardDeviceUid === normalizedDeviceUid) {
      dashboardSocket.data.screenMirrorDashboardDeviceUid = null;
    }
    dashboardSocket.emit("security:error", {
      event: "device:ownership-changed",
      reason: "forbidden"
    });
  }

  updateScreenMirrorViewerCount(normalizedDeviceUid);
  emitScreenMirrorStatus(normalizedDeviceUid);
}

function buildWebRtcSessionDescription(payload = {}) {
  const descriptionSources = [
    payload,
    payload?.description,
    payload?.offer,
    payload?.answer,
    payload?.sessionDescription,
    payload?.desc
  ];

  for (const source of descriptionSources) {
    let normalizedSource = source;
    if (typeof normalizedSource === "string") {
      try {
        normalizedSource = JSON.parse(normalizedSource);
      } catch (_error) {
        normalizedSource = { sdp: normalizedSource };
      }
    }

    if (!normalizedSource || typeof normalizedSource !== "object") continue;

    const type =
      typeof normalizedSource?.type === "string"
        ? normalizedSource.type.trim().toLowerCase()
        : "";
    let sdp =
      typeof normalizedSource?.sdp === "string"
        ? normalizedSource.sdp.trim()
        : "";
    if (sdp.startsWith('"') && sdp.endsWith('"')) {
      try {
        sdp = JSON.parse(sdp);
      } catch (_error) {
      }
    }
    sdp = String(sdp || "")
      .replace(/\\r\\n/g, "\r\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .trim();

    if (!["offer", "answer"].includes(type) || !sdp || !sdp.startsWith("v=")) continue;
    return { type, sdp };
  }

  return null;
}

function buildWebRtcIceCandidate(payload = {}) {
  const candidate = typeof payload?.candidate === "string" ? payload.candidate.trim() : "";
  if (!candidate) return null;

  const sdpMid =
    typeof payload?.sdpMid === "string" && payload.sdpMid.trim()
      ? payload.sdpMid.trim()
      : null;
  const parsedMLineIndex = Number(payload?.sdpMLineIndex);
  const sdpMLineIndex = Number.isFinite(parsedMLineIndex)
    ? Math.max(0, Math.round(parsedMLineIndex))
    : null;

  return {
    candidate,
    sdpMid,
    sdpMLineIndex
  };
}

function updateScreenMirrorViewerCount(deviceUid) {
  const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
  if (!normalizedDeviceUid) return;

  const session = ensureScreenMirrorSession(normalizedDeviceUid);
  if (!session) return;

  let viewerCount = 0;
  for (const mappedDeviceUid of screenMirrorViewerDeviceBySocketId.values()) {
    if (mappedDeviceUid === normalizedDeviceUid) {
      viewerCount += 1;
    }
  }
  session.viewerCount = viewerCount;
  session.updatedAtMs = Date.now();
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
    const activeSocketCount = registerDeviceSocketConnection(socket, deviceUid);
    emitDevicePresenceStatus(deviceUid);
    console.log("[DEVICE_SOCKET] device joined", {
      deviceUid,
      socketId: socket.id,
      activeSocketCount
    });
  });

  const acknowledgeCommandClaim = (ack, payload, response) => {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId.trim() : "";
    const responsePayload = {
      ...(response && typeof response === "object" ? response : { success: false }),
      ...(requestId ? { requestId } : {})
    };

    if (typeof ack === "function") {
      ack(responsePayload);
      return;
    }

    socket.emit("command:claim:response", responsePayload);
  };

  socket.on("command:claim", async (payload = {}, ack) => {
    const deviceUid = requireDeviceSocket("command:claim", payload);
    if (!deviceUid) {
      acknowledgeCommandClaim(ack, payload, { success: false, error: "unauthorized" });
      return;
    }

    try {
      if (deviceUidBySocketId.get(socket.id) !== deviceUid) {
        socket.join(`device:${deviceUid}`);
        const activeSocketCount = registerDeviceSocketConnection(socket, deviceUid);
        emitDevicePresenceStatus(deviceUid);
        console.log("[DEVICE_SOCKET] command claim auto-joined device socket", {
          deviceUid,
          socketId: socket.id,
          activeSocketCount
        });
      }

      const claimResponse = await claimNextPendingCommandForDevice(deviceUid, {
        transport: "socket"
      });
      acknowledgeCommandClaim(ack, payload, claimResponse);
    } catch (error) {
      console.error("[SocketCommandClaim] failed", {
        socketId: socket.id,
        deviceUid,
        ...safeErrorMetadata(error)
      });
      acknowledgeCommandClaim(ack, payload, {
        success: false,
        error: error?.statusCode === 400 ? DEVICE_UID_FORMAT_ERROR : "internal_error"
      });
    }
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
        ...safeErrorMetadata(error)
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
    session.width = Number.isFinite(Number(payload?.width))
      ? Math.max(0, Math.round(Number(payload.width)))
      : null;
    session.height = Number.isFinite(Number(payload?.height))
      ? Math.max(0, Math.round(Number(payload.height)))
      : null;
    session.fps = Number.isFinite(Number(payload?.fps))
      ? Math.max(0, Math.round(Number(payload.fps)))
      : null;
    session.updatedAtMs = Date.now();

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
    session.updatedAtMs = Date.now();

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
    session.updatedAtMs = Date.now();

    console.log("[SCREEN_MIRROR] error", {
      deviceUid,
      hasReason: typeof payload?.reason === "string" && payload.reason.trim() !== ""
    });
    io.to(`dashboard:${deviceUid}`).emit("screen:status", {
      ...buildScreenMirrorStatus(deviceUid),
      reason: payload?.reason ?? null
    });
  });

  socket.on("screen:webrtc-offer", async (payload = {}) => {
    try {
      if (!isDashboardSocket(socket)) {
        logSecurityEvent("socket_event_rejected", {
          socketId: socket.id,
          event: "screen:webrtc-offer",
          reason: "device_socket_cannot_emit_dashboard_webrtc_offer"
        });
        socket.emit("security:error", { event: "screen:webrtc-offer", reason: "unauthorized" });
        return;
      }

      const deviceUid = normalizeDeviceUid(payload?.deviceUid);
      const description = buildWebRtcSessionDescription(payload);
      if (!deviceUid || !description || description.type !== "offer") return;

      const canJoin = await canDashboardJoinDevice(socket.data.userId, deviceUid);
      if (!canJoin) {
        logSecurityEvent("socket_webrtc_offer_denied", {
          socketId: socket.id,
          event: "screen:webrtc-offer",
          deviceUid,
          userId: socket.data.userId,
          reason: "device_not_owned_by_user"
        });
        socket.emit("security:error", { event: "screen:webrtc-offer", reason: "forbidden" });
        return;
      }

      socket.join(`dashboard:${deviceUid}`);
      socket.data.screenMirrorDashboardDeviceUid = deviceUid;
      screenMirrorViewerDeviceBySocketId.set(socket.id, deviceUid);
      updateScreenMirrorViewerCount(deviceUid);
      emitScreenMirrorStatus(deviceUid);

      io.to(`device:${deviceUid}`).emit("screen:webrtc-offer", {
        deviceUid,
        viewerId: socket.id,
        ...description
      });
    } catch (error) {
      logSecurityEvent("socket_webrtc_offer_failed", {
        socketId: socket.id,
        event: "screen:webrtc-offer",
        userId: socket.data.userId ?? null,
        ...safeErrorMetadata(error)
      });
      socket.emit("security:error", {
        event: "screen:webrtc-offer",
        reason: "internal_error"
      });
    }
  });

  socket.on("screen:webrtc-answer", (payload = {}) => {
    const deviceUid = requireDeviceSocket("screen:webrtc-answer", payload);
    if (!deviceUid) return;

    const viewerId = typeof payload?.viewerId === "string" ? payload.viewerId.trim() : "";
    const expectedDeviceUid = screenMirrorViewerDeviceBySocketId.get(viewerId);
    const description = buildWebRtcSessionDescription(payload);
    if (!viewerId || expectedDeviceUid !== deviceUid || !description || description.type !== "answer") {
      return;
    }

    io.to(viewerId).emit("screen:webrtc-answer", {
      deviceUid,
      viewerId,
      ...description
    });
  });

  socket.on("screen:webrtc-ice-candidate", async (payload = {}) => {
    try {
      const candidate = buildWebRtcIceCandidate(payload);
      if (!candidate) return;

      if (isDashboardSocket(socket)) {
        const deviceUid = normalizeDeviceUid(payload?.deviceUid);
        if (!deviceUid) return;

        const canJoin = await canDashboardJoinDevice(socket.data.userId, deviceUid);
        if (!canJoin) {
          logSecurityEvent("socket_webrtc_ice_denied", {
            socketId: socket.id,
            event: "screen:webrtc-ice-candidate",
            deviceUid,
            userId: socket.data.userId,
            reason: "device_not_owned_by_user"
          });
          socket.emit("security:error", {
            event: "screen:webrtc-ice-candidate",
            reason: "forbidden"
          });
          return;
        }

        screenMirrorViewerDeviceBySocketId.set(socket.id, deviceUid);
        updateScreenMirrorViewerCount(deviceUid);
        io.to(`device:${deviceUid}`).emit("screen:webrtc-ice-candidate", {
          deviceUid,
          viewerId: socket.id,
          ...candidate
        });
        return;
      }

      if (isDeviceSocket(socket)) {
        const deviceUid = requireDeviceSocket("screen:webrtc-ice-candidate", payload);
        if (!deviceUid) return;

        const viewerId = typeof payload?.viewerId === "string" ? payload.viewerId.trim() : "";
        const expectedDeviceUid = screenMirrorViewerDeviceBySocketId.get(viewerId);
        if (!viewerId || expectedDeviceUid !== deviceUid) return;

        io.to(viewerId).emit("screen:webrtc-ice-candidate", {
          deviceUid,
          viewerId,
          ...candidate
        });
      }
    } catch (error) {
      logSecurityEvent("socket_webrtc_ice_failed", {
        socketId: socket.id,
        event: "screen:webrtc-ice-candidate",
        userId: socket.data.userId ?? null,
        ...safeErrorMetadata(error)
      });
    }
  });

  socket.on("screen:webrtc-viewer-stop", (payload = {}) => {
    if (!isDashboardSocket(socket)) return;

    const deviceUid =
      normalizeDeviceUid(payload?.deviceUid) ||
      normalizeDeviceUid(screenMirrorViewerDeviceBySocketId.get(socket.id));
    if (!deviceUid) return;

    screenMirrorViewerDeviceBySocketId.delete(socket.id);
    updateScreenMirrorViewerCount(deviceUid);
    io.to(`device:${deviceUid}`).emit("screen:webrtc-viewer-left", {
      deviceUid,
      viewerId: socket.id
    });
    emitScreenMirrorStatus(deviceUid);
  });

  socket.on("disconnect", () => {
    const disconnectedDeviceUid = unregisterDeviceSocketConnection(socket.id);
    if (disconnectedDeviceUid) {
      const activeSocketCount = getActiveDeviceSocketCount(disconnectedDeviceUid);
      emitDevicePresenceStatus(disconnectedDeviceUid);
      console.log("[DEVICE_SOCKET] device disconnected", {
        deviceUid: disconnectedDeviceUid,
        socketId: socket.id,
        activeSocketCount
      });
    }

    const deviceUid = screenMirrorViewerDeviceBySocketId.get(socket.id);
    if (deviceUid) {
      screenMirrorViewerDeviceBySocketId.delete(socket.id);
      updateScreenMirrorViewerCount(deviceUid);
      io.to(`device:${deviceUid}`).emit("screen:webrtc-viewer-left", {
        deviceUid,
        viewerId: socket.id
      });
      emitScreenMirrorStatus(deviceUid);
    }
  });
});

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  return res.status(200).json({ ok: true });
});

const DUMMY_CHUNK = Buffer.alloc(DUMMY_DOWNLOAD_CHUNK_BYTES, 0x61);

app.get("/dummy-download", dummyDownloadRateLimiter, requireAuthenticatedDevice, async (req, res) => {
  const requestedMb = parseDownloadSizeMb(req.query?.mb);
  if (requestedMb === null) {
    return res.status(400).json({
      error: `mb must be an integer between ${DUMMY_DOWNLOAD_MIN_MB} and ${DUMMY_DOWNLOAD_MAX_MB}`
    });
  }

  const totalBytes = requestedMb * 1024 * 1024;
  let remainingBytes = totalBytes;
  let bytesSent = 0;
  let streamSettled = false;
  let streamStopped = false;
  let reservation;

  try {
    reservation = await reserveAuthorizedDummyDownload({
      device: req.authenticatedDevice,
      deviceUid: req.deviceUid,
      requestedMb,
      ip: req.ip
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode === 403 || statusCode === 429) {
      logSecurityEvent("dummy_download_rejected", {
        ip: req.ip,
        deviceUid: req.deviceUid ?? null,
        reason: error?.code || "download_rejected"
      });
      return res.status(statusCode).json({ error: error.message });
    }
    return handleServerError(res, error, "GET /dummy-download authorization");
  }

  console.log("[DummyDownload] start", {
    deviceUid: req.deviceUid ?? null,
    commandId: reservation.commandId,
    mb: requestedMb
  });

  res.status(200);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(totalBytes));
  res.setHeader("Cache-Control", "no-store");

  const finalizeStream = (completed) => {
    if (streamSettled) return;
    streamSettled = true;
    streamStopped = true;
    res.removeListener("drain", streamChunks);

    void reservation
      .finalize({ completed, bytesSent })
      .catch((error) => {
        console.error("[DummyDownload] Failed to finalize reservation", {
          deviceUid: req.deviceUid ?? null,
          commandId: reservation.commandId,
          completed,
          bytesSent,
          ...safeErrorMetadata(error)
        });
      });
  };

  const streamChunks = () => {
    if (streamStopped || res.destroyed) {
      finalizeStream(false);
      return;
    }

    try {
      while (remainingBytes > 0 && !streamStopped) {
        const bytesToWrite = Math.min(DUMMY_DOWNLOAD_CHUNK_BYTES, remainingBytes);
        const payload =
          bytesToWrite === DUMMY_DOWNLOAD_CHUNK_BYTES
            ? DUMMY_CHUNK
            : DUMMY_CHUNK.subarray(0, bytesToWrite);
        const canContinue = res.write(payload);
        remainingBytes -= bytesToWrite;
        bytesSent += bytesToWrite;

        if (!canContinue) {
          res.once("drain", streamChunks);
          return;
        }
      }

      if (!streamStopped) {
        res.end();
      }
    } catch (error) {
      finalizeStream(false);
      res.destroy(error);
    }
  };

  res.once("finish", () => finalizeStream(remainingBytes === 0));
  res.once("close", () => {
    if (!res.writableFinished) {
      finalizeStream(false);
    }
  });

  return streamChunks();
});

const authRouter = createAuthRouter({
  User,
  requireAuth,
  getAdminSetupKey,
  isAuthEnabled,
  respondAuthDisabled,
  parseRequestBodyObject,
  parseUsername,
  parsePassword,
  parseRegistrationPassword,
  logSecurityEvent,
  BCRYPT_SALT_ROUNDS,
  signAccessToken,
  mapUserForResponse,
  handleServerError,
  normalizeAuthUserId,
  createPairingTokenForUser,
  resolvePublicServerUrl,
  PAIRING_TOKEN_TYPE,
  PAIRING_TOKEN_TTL_MS,
  setAccessTokenCookie,
  clearAccessTokenCookie,
  isSecretEqual,
  createPairingQrDataUrl
});
app.use(authRouter);

const devicesRouter = createDevicesRouter({
  Device,
  User,
  requireAuth,
  requireAuthenticatedDevice,
  extractDeviceRegistrationInput,
  normalizeEsimSubscriptions,
  normalizeDeviceUid,
  extractDeviceTokenFromRequest,
  toUtcISOString,
  isDeviceTokenMatch,
  logSecurityEvent,
  buildDefaultDeviceName,
  normalizeDeviceName,
  issueDeviceTokenForDevice,
  mapDeviceForResponseWithLinkedAccount,
  mapDeviceListForResponseWithLinkedAccount,
  handleServerError,
  normalizeAuthUserId,
  parseIncludeUnclaimedQueryValue,
  normalizePairingToken,
  normalizeManualPairingCode,
  inspectPairingCredential,
  getPairingCredentialFailureHttpStatus,
  getPairingCredentialFailureMessage,
  getPairingCredentialFailureMessageForType,
  consumePairingTokenByHash,
  hashDeviceToken,
  isDeviceOwnedByUser,
  mapDeviceForResponse,
  parseRequestBodyObject,
  DEVICE_UID_FORMAT_ERROR,
  translatePairingTokenReasonToCodeReason,
  revokeDashboardAccessForDevice
});
app.use(devicesRouter);

const commandsRouter = createCommandsRouter({
  Device,
  Command,
  CollectionTemplate,
  CommandCollectionService,
  requireAuth,
  requireAuthenticatedDevice,
  normalizeDeviceUid,
  normalizeAuthUserId,
  isDeviceOwnedByUser,
  parseScheduledAtAsRiyadhToUtcDate,
  normalizeHttpUrl,
  resolveOpenAppTarget,
  parseDownloadSizeMb,
  parseTouchTarget,
  parseNonNegativeCoordinate,
  parsePositiveDimension,
  parseTouchDurationMs,
  toUtcISOString,
  shouldApplyCommandDuplicateGuard,
  buildCommandDuplicateSignature,
  mapCommandForResponse,
  emitCommandCreated,
  logCommandLifecycle,
  logSecurityEvent,
  logOpenAppResolver,
  logReturnToAutoCallEvent,
  emitCommandUpdated,
  formatUtcForRiyadhDisplay,
  handleServerError,
  getCommandFetchCutoffDate,
  claimNextPendingCommandForDevice,
  emitCommandsCleared,
  unsetIfPresent,
  DEVICE_UID_FORMAT_ERROR,
  ESIM_ACTIVATION_CODE_MAX_LENGTH,
  DUMMY_DOWNLOAD_MIN_MB,
  DUMMY_DOWNLOAD_MAX_MB,
  COMMAND_DUPLICATE_GUARD_WINDOW_MS
});
app.use(commandsRouter);

// ==========================================
// Address Book (Contacts) Routes
// ==========================================
app.get(["/contacts", "/api/contacts"], requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const contacts = await Contact.find({ userId: currentUserId }).sort({ name: 1 }).lean();
    return res.json(contacts);
  } catch (error) {
    return handleServerError(res, error, "GET /contacts");
  }
});

app.post(["/contacts", "/api/contacts"], requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, phoneNumber } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Contact name is required and must be a non-empty string" });
    }
    if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
      return res.status(400).json({ error: "Phone number is required and must be a non-empty string" });
    }

    const trimmedName = name.trim();
    const trimmedPhoneNumber = phoneNumber.trim();

    const matchingContacts = await Contact.find({
      userId: currentUserId,
      $or: [
        { phoneNumber: trimmedPhoneNumber },
        { name: trimmedName }
      ]
    }).limit(2);

    // Preserve phone-number precedence while resolving both possible matches in one query.
    let contact = matchingContacts.find(
      (candidate) => candidate.phoneNumber === trimmedPhoneNumber
    );

    if (contact) {
      // If same phone number exists, overwrite/update the contact's name to the new one
      contact.name = trimmedName;
      await contact.save();
    } else {
      contact = matchingContacts.find((candidate) => candidate.name === trimmedName);
      if (contact) {
        // If same name exists, overwrite/update the phone number
        contact.phoneNumber = trimmedPhoneNumber;
        await contact.save();
      } else {
        // Create a new contact
        contact = await Contact.create({
          userId: currentUserId,
          name: trimmedName,
          phoneNumber: trimmedPhoneNumber
        });
      }
    }

    return res.status(201).json(contact);
  } catch (error) {
    return handleServerError(res, error, "POST /contacts");
  }
});

app.delete(["/contacts/:id", "/api/contacts/:id"], requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid contact ID format" });
    }

    const deletedContact = await Contact.findOneAndDelete({
      _id: id,
      userId: currentUserId
    });

    if (!deletedContact) {
      return res.status(404).json({ error: "Contact not found or access denied" });
    }

    return res.json({ success: true, message: "Contact deleted successfully", contact: deletedContact });
  } catch (error) {
    return handleServerError(res, error, "DELETE /contacts/:id");
  }
});

// ==========================================
// Autonomous AI Agent Chat Endpoint
// ==========================================
app.post("/agent/chat", requireAuth, async (req, res) => {
  try {
    const currentUserId = normalizeAuthUserId(req.user?.id);
    if (!currentUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { message, history = [] } = req.body;
    const normalizedMessage = typeof message === "string" ? message.trim() : "";
    const normalizedHistory = normalizeAgentHistory(history);
    if (!normalizedMessage || normalizedMessage.length > AGENT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ error: "Message prompt is required and must be a string" });
    }
    if (!normalizedHistory) {
      return res.status(400).json({ error: "Invalid agent conversation history" });
    }

    // 1. Context Compilation - Fetch user's registered devices
    const devices = await Device.find({ ownerUserId: currentUserId }).select("+ownershipEpoch");
    await Promise.all(devices.map((device) => ensureDeviceOwnershipEpoch(device)));
    const formattedDevices = devices.map(d => ({
      deviceUid: d.deviceUid,
      deviceName: d.deviceName || buildDefaultDeviceName(d.deviceUid),
      platform: d.platform,
      online: isDeviceOnlineBySocket(d.deviceUid)
    }));

    if (formattedDevices.length === 0) {
      return res.json({
        response: "I couldn't find any paired devices for your account. Please pair a device first to execute automation commands.",
        status: "no_devices",
        draftCommand: null
      });
    }

    // 2. Context Compilation - Pre-filter matching contacts to reduce token usage & hallucinations
    // Simple extraction of capitalized words to identify potential contact names in the message
    const capitalizedWords = (normalizedMessage.match(/[A-Z][a-z]+/g) || []).map(w => w.trim());
    const uniquePotentialNames = [...new Set(capitalizedWords)];
    
    let contacts = [];
    if (uniquePotentialNames.length > 0) {
      const regexPool = uniquePotentialNames.map(
        (name) => new RegExp(escapeRegexLiteral(name), "i")
      );
      contacts = await Contact.find({
        userId: currentUserId,
        name: { $in: regexPool }
      }).limit(5).lean();
    } else {
      contacts = await Contact.find({ userId: currentUserId }).sort({ name: 1 }).limit(10).lean();
    }

    // Resolve the active target device UID
    let selectedDeviceUid = normalizeDeviceUid(req.body.deviceUid);
    if (!selectedDeviceUid && formattedDevices.length > 0) {
      const onlineDevice = formattedDevices.find(d => d.online);
      selectedDeviceUid = onlineDevice ? onlineDevice.deviceUid : formattedDevices[0].deviceUid;
    }

    // 3. Hand over to LLM Orchestrator Service
    const agentResult = await runAgentOrchestrator({
      prompt: normalizedMessage,
      history: normalizedHistory,
      contacts: contacts.map(c => ({ name: c.name, phoneNumber: c.phoneNumber })),
      devices: formattedDevices,
      timezone: RIYADH_TIMEZONE,
      currentTime: new Date().toISOString(),
      activeDeviceUid: selectedDeviceUid
    });

    // 4. Implement 100% Immediate Auto-Execution for all Agent Commands
    if (agentResult.draftCommand) {
      // Validate that the AI resolved a real deviceUid owned by this user
      const targetDevice = devices.find(d => d.deviceUid === agentResult.draftCommand.deviceUid);
      if (!targetDevice) {
        return res.status(400).json({
          error: "Agent targeted an invalid or unauthorized deviceUid.",
          response: "I apologize, but I couldn't target the requested device safely.",
          draftCommand: null
        });
      }

      // If the command is a collection execution trigger
      if (agentResult.draftCommand.action === "execute_collection") {
        const collectionName =
          typeof agentResult.draftCommand.collectionName === "string"
            ? agentResult.draftCommand.collectionName.trim()
            : "";
        if (!collectionName || collectionName.length > 120) {
          return res.status(400).json({
            error: "Agent returned an invalid collection name.",
            response: "I couldn't safely identify that collection.",
            draftCommand: null
          });
        }
        const template = await CollectionTemplate.findOne({
          ownerUserId: currentUserId,
          name: { $regex: new RegExp(`^${escapeRegexLiteral(collectionName)}$`, "i") }
        });

        if (!template) {
          return res.status(404).json({
            error: `Template '${collectionName}' not found.`,
            response: `I couldn't find any collection template named '${collectionName}'.`,
            draftCommand: null
          });
        }

        // Trigger execution via CommandCollectionService
        const collection = await CommandCollectionService.createAndStartCollection(
          template.name,
          targetDevice.deviceUid,
          template.commandTemplates,
          currentUserId
        );

        return res.json({
          response: `Successfully started the collection '${template.name}' on the current device.`,
          status: "auto_executed",
          collection: {
            id: String(collection._id),
            name: collection.name,
            deviceUid: collection.deviceUid,
            status: collection.status
          },
          draftCommand: null
        });
      }

      // Auto-Execute ALL Commands Immediately
      const finalCommandData = buildValidatedAgentCommandData(
        agentResult.draftCommand,
        targetDevice,
        currentUserId
      );
      if (!finalCommandData) {
        return res.status(400).json({
          error: "Agent returned an invalid command payload.",
          response: "I couldn't queue that command because its parameters were not safe or valid.",
          draftCommand: null
        });
      }

      const command = new Command(finalCommandData);
      try {
        await command.validate();
        await command.save();
      } catch (validationError) {
        logSecurityEvent("agent_command_validation_failed", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          userId: currentUserId,
          deviceUid: targetDevice.deviceUid,
          reason: validationError?.name || "validation_failed"
        });
        return res.status(400).json({
          error: "Agent returned an invalid command payload.",
          response: "I couldn't queue that command because its parameters were not safe or valid.",
          draftCommand: null
        });
      }

      logCommandLifecycle("created", {
        commandId: commandIdFrom(command),
        deviceUid: targetDevice.deviceUid,
        oldStatus: null,
        newStatus: "pending",
        details: {
          action: command.action,
          type: command.type,
          agentAutoExecuted: true
        }
      });

      const commandResponse = emitCommandCreated(command);

      return res.json({
        response: agentResult.response,
        status: "auto_executed",
        command: commandResponse,
        draftCommand: null
      });
    }

    // Return the response for general conversational queries
    return res.json({
      response: agentResult.response,
      status: "conversation",
      draftCommand: null
    });

  } catch (error) {
    return handleServerError(res, error, "POST /agent/chat");
  }
});

app.use(express.static("public"));
app.use((error, req, res, next) => {
  console.error("[ExpressError]", safeErrorMetadata(error));
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
let pairingTokenCleanupIntervalId = null;

function warnIfJwtSecretMissing() {
  const jwtIssue = getJwtSecretConfigurationIssue();
  if (jwtIssue) {
    console.error(
      `[Auth] JWT_SECRET is ${jwtIssue === "missing" ? "missing" : `shorter than ${JWT_SECRET_MIN_BYTES} bytes`}. Authentication is disabled until a strong secret is configured.`
    );
  }

  const adminKeyIssue = getAdminSetupKeyConfigurationIssue();
  if (adminKeyIssue) {
    console.error(
      `[Auth] ADMIN_SETUP_KEY is ${adminKeyIssue === "missing" ? "missing" : `shorter than ${ADMIN_SETUP_KEY_MIN_BYTES} bytes`}. User registration is disabled until a strong setup key is configured.`
    );
  }
}

function startPairingTokenMemoryCleanupLoop() {
  if (pairingTokenCleanupIntervalId) {
    clearInterval(pairingTokenCleanupIntervalId);
    pairingTokenCleanupIntervalId = null;
  }

  pairingTokenCleanupIntervalId = setInterval(() => {
    const nowMs = Date.now();
    cleanupExpiredPairingTokensInMemory(nowMs);
    cleanupInactiveScreenMirrorSessions(nowMs);
  }, PAIRING_TOKEN_EXPIRY_CLEANUP_INTERVAL_MS);

  if (typeof pairingTokenCleanupIntervalId.unref === "function") {
    pairingTokenCleanupIntervalId.unref();
  }
}

function isExpiresAtAscendingSingleFieldIndex(indexInfo) {
  if (!indexInfo || typeof indexInfo !== "object") return false;
  if (!indexInfo.key || typeof indexInfo.key !== "object") return false;

  const keyEntries = Object.entries(indexInfo.key);
  if (keyEntries.length !== 1) return false;

  const [fieldName, direction] = keyEntries[0];
  return fieldName === "expiresAt" && Number(direction) === 1;
}

async function ensurePairingTokenExpiryTtlIndex() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  try {
    const collection = PairingToken.collection;
    let indexes = [];
    try {
      indexes = await collection.indexes();
    } catch (error) {
      const message = String(error?.message || "");
      const isNamespaceMissing =
        Number(error?.code) === 26 ||
        /ns not found/i.test(message) ||
        /namespace/i.test(message);
      if (!isNamespaceMissing) {
        throw error;
      }
    }

    const expiresAtIndexes = indexes.filter(isExpiresAtAscendingSingleFieldIndex);
    const hasCorrectTtlIndex = expiresAtIndexes.some(
      (indexInfo) => Number(indexInfo.expireAfterSeconds) === 0
    );

    if (hasCorrectTtlIndex) {
      return;
    }

    for (const indexInfo of expiresAtIndexes) {
      if (!indexInfo?.name) continue;
      await collection.dropIndex(indexInfo.name);
    }

    await collection.createIndex(
      { expiresAt: 1 },
      {
        expireAfterSeconds: 0,
        name: "expiresAt_1"
      }
    );

    console.log("[PairingToken] TTL index ensured for expiresAt");
  } catch (error) {
    console.error("[PairingToken] Failed to ensure TTL index:", safeErrorMetadata(error));
  }
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
  startPairingTokenMemoryCleanupLoop();

  // Initialize Sequential Command Collection Service with Socket.io and Mapper
  CommandCollectionService.initialize(io, mapCommandForResponse);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  await connectToDatabase();
  await ensurePairingTokenExpiryTtlIndex();
  await cleanupLegacyDeviceUidData();
}

startServer();
