const { normalizeDeviceUid } = require("../domain/deviceUid");
const { hasPresentValue, toPlainObject } = require("../utils/objects");

const COMMAND_DUPLICATE_EXCLUDED_ACTIONS = new Set(["screen_touch", "screen_swipe"]);

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

module.exports = {
  buildCommandDuplicateSignature,
  shouldApplyCommandDuplicateGuard
};
