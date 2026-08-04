const express = require("express");
const mongoose = require("mongoose");
const { hasPresentValue, addIfPresent, commandIdFrom, toPlainObject } = require("../utils/objects");
const { ensureDeviceOwnershipEpoch } = require("../security/deviceOwnership");
const { safeErrorMetadata } = require("../security/safeError");
const {
  COMMAND_ACTION_TO_TYPE,
  COMMAND_TYPE_TO_ACTION
} = require("../domain/commandTypes");

const COMMAND_PAGE_DEFAULT_SIZE = 100;
const COMMAND_PAGE_MAX_SIZE = 200;
const COMMAND_PAGE_MAX_NUMBER = 1000;
const COMMAND_DASHBOARD_SORT = {
  isImmediate: -1,
  scheduledAt: 1,
  createdAt: -1,
  _id: -1
};

function parsePositiveIntegerQuery(value, defaultValue, maximum) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return null;
  return parsed;
}

function commandMatchesDeviceOwnership(command, device, expectedUserId = null) {
  if (!command?.ownerUserId || !command?.deviceOwnershipEpoch || !device?.ownerUserId) {
    return false;
  }
  if (String(command.ownerUserId) !== String(device.ownerUserId)) return false;
  if (expectedUserId && String(command.ownerUserId) !== String(expectedUserId)) return false;
  return command.deviceOwnershipEpoch === device.ownershipEpoch;
}

/**
 * Creates and configures the Commands and Collections router.
 * Uses dependency injection to access models, middlewares, services, and helper utilities.
 */
function createCommandsRouter({
  Device,
  Command,
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
}) {
  const router = express.Router();

  router.post("/commands", requireAuth, async (req, res) => {
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
        activationCode,
        esimSubscriptionId,
        esimPortIndex,
        subscriptionId,
        enabled,
        autoHangupSeconds,
        x,
        y,
        screenWidth,
        screenHeight,
        startX,
        startY,
        endX,
        endY,
        durationMs,
        touchTarget
      } = req.body;

      const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
      if (!normalizedDeviceUid) {
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }

      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const targetDevice = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
        "+ownershipEpoch"
      );
      if (!targetDevice) {
        return res.status(404).json({ error: "Device not found" });
      }

      if (!targetDevice.ownerUserId) {
        return res.status(403).json({ error: "Device is not claimed" });
      }

      if (!isDeviceOwnedByUser(targetDevice, currentUserId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!(await ensureDeviceOwnershipEpoch(targetDevice))) {
        return res.status(500).json({ error: "Internal server error" });
      }

      let scheduledAtDate = null;
      const normalizedActionInput =
        typeof action === "string" && action.trim()
          ? action.trim().toLowerCase()
          : null;
      const normalizedTypeInput =
        typeof type === "string" && type.trim()
          ? type.trim().toUpperCase()
          : null;

      if (normalizedActionInput && !COMMAND_ACTION_TO_TYPE[normalizedActionInput]) {
        logSecurityEvent("command_rejected_invalid_action", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          action: normalizedActionInput,
          deviceUid: normalizedDeviceUid
        });
        return res.status(400).json({
          error:
            "Invalid action. Only 'call', 'end', 'sms', 'auto_answer', 'open_url', 'close_webview', 'open_app', 'return_to_autocall', 'download_data', 'activate_esim', 'delete_esim', 'start_screen_mirror', 'stop_screen_mirror', 'screen_touch', and 'screen_swipe' are supported."
        });
      }

      if (normalizedTypeInput && !COMMAND_TYPE_TO_ACTION[normalizedTypeInput]) {
        logSecurityEvent("command_rejected_invalid_type", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          type: normalizedTypeInput,
          deviceUid: normalizedDeviceUid
        });
        return res.status(400).json({
          error:
            "Invalid type. Only 'CALL', 'END', 'SMS', 'AUTO_ANSWER', 'OPEN_URL', 'CLOSE_WEBVIEW', 'OPEN_APP', 'RETURN_TO_AUTOCALL', 'DOWNLOAD_DATA', 'ACTIVATE_ESIM', 'DELETE_ESIM', 'START_SCREEN_MIRROR', 'STOP_SCREEN_MIRROR', 'SCREEN_TOUCH', and 'SCREEN_SWIPE' are supported."
        });
      }

      if (
        normalizedActionInput &&
        normalizedTypeInput &&
        COMMAND_ACTION_TO_TYPE[normalizedActionInput] !== normalizedTypeInput
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

      let normalizedAction =
        normalizedActionInput ?? COMMAND_TYPE_TO_ACTION[normalizedTypeInput] ?? "call";
      const commandType = normalizedTypeInput ?? COMMAND_ACTION_TO_TYPE[normalizedAction];
      const isAutoAnswerCommand = normalizedAction === "auto_answer";
      const isOpenUrlCommand = normalizedAction === "open_url";
      const isOpenAppCommand = normalizedAction === "open_app";
      const isReturnToAutoCallCommand = normalizedAction === "return_to_autocall";
      const isDownloadDataCommand = normalizedAction === "download_data";
      const isActivateEsimCommand = normalizedAction === "activate_esim";
      const isDeleteEsimCommand = normalizedAction === "delete_esim";
      const isScreenTouchCommand = normalizedAction === "screen_touch";
      const isScreenSwipeCommand = normalizedAction === "screen_swipe";
      const allowsExtraPayloadFields = isReturnToAutoCallCommand;
      const isCallOrSmsCommand = normalizedAction === "call" || normalizedAction === "sms";

      const receivedPhoneNumberRaw = typeof phoneNumber === "string" ? phoneNumber : "";
      const normalizedPhoneNumber = receivedPhoneNumberRaw.trim();
      if (normalizedPhoneNumber.length > 40) {
        return res.status(400).json({ error: "phoneNumber must not exceed 40 characters" });
      }
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
      if (normalizedMessage.length > 4000) {
        return res.status(400).json({ error: "message must not exceed 4000 characters" });
      }
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
      if (normalizedUrlRaw.length > 2048) {
        return res.status(400).json({ error: "url must not exceed 2048 characters" });
      }
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
      if (normalizedAppNameRaw.length > 200) {
        return res.status(400).json({ error: "appName must not exceed 200 characters" });
      }
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
      if (normalizedNotes.length > 1000) {
        return res.status(400).json({ error: "notes must not exceed 1000 characters" });
      }

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

      const normalizedActivationCode =
        typeof activationCode === "string" ? activationCode.trim() : "";
      if (isActivateEsimCommand) {
        if (!normalizedActivationCode) {
          return res.status(400).json({
            error: "activationCode is required for ACTIVATE_ESIM commands"
          });
        }

        if (normalizedActivationCode.length > ESIM_ACTIVATION_CODE_MAX_LENGTH) {
          return res.status(400).json({
            error: `activationCode must be ${ESIM_ACTIVATION_CODE_MAX_LENGTH} characters or less`
          });
        }
      } else if (normalizedActivationCode && !allowsExtraPayloadFields) {
        return res.status(400).json({
          error: "activationCode is only supported for ACTIVATE_ESIM commands"
        });
      }

      let normalizedEsimSubscriptionId;
      let normalizedEsimPortIndex;
      const hasEsimSubscriptionIdInput = hasPresentValue(esimSubscriptionId);
      const hasEsimPortIndexInput = hasPresentValue(esimPortIndex);
      if (isDeleteEsimCommand) {
        const parsedSubscriptionId = Number(esimSubscriptionId);
        if (!Number.isInteger(parsedSubscriptionId) || parsedSubscriptionId < 0) {
          return res.status(400).json({
            error: "esimSubscriptionId is required and must be a non-negative integer for DELETE_ESIM commands"
          });
        }
        normalizedEsimSubscriptionId = parsedSubscriptionId;

        if (hasEsimPortIndexInput) {
          const parsedPortIndex = Number(esimPortIndex);
          if (!Number.isInteger(parsedPortIndex) || parsedPortIndex < 0) {
            return res.status(400).json({
              error: "esimPortIndex must be a non-negative integer"
            });
          }
          normalizedEsimPortIndex = parsedPortIndex;
        }
      } else if ((hasEsimSubscriptionIdInput || hasEsimPortIndexInput) && !allowsExtraPayloadFields) {
        return res.status(400).json({
          error: "eSIM subscription fields are only supported for DELETE_ESIM commands"
        });
      }

      let normalizedSubscriptionId;
      const hasSubscriptionIdInput = hasPresentValue(subscriptionId);
      if (hasSubscriptionIdInput) {
        if (!isCallOrSmsCommand && !allowsExtraPayloadFields) {
          return res.status(400).json({
            error: "subscriptionId is only supported for CALL and SMS commands"
          });
        }

        const parsedSubscriptionId = Number(subscriptionId);
        if (!Number.isInteger(parsedSubscriptionId) || parsedSubscriptionId < 0) {
          return res.status(400).json({
            error: "subscriptionId must be a non-negative integer"
          });
        }

        const reportedSubscriptions = Array.isArray(targetDevice.esimSubscriptions)
          ? targetDevice.esimSubscriptions
          : [];
        if (
          reportedSubscriptions.length > 0 &&
          !reportedSubscriptions.some((profile) => Number(profile?.subscriptionId) === parsedSubscriptionId)
        ) {
          return res.status(400).json({
            error: "subscriptionId does not belong to the selected device"
          });
        }

        normalizedSubscriptionId = parsedSubscriptionId;
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

      const hasTouchTargetInput = hasPresentValue(touchTarget);
      const normalizedTouchTarget = hasTouchTargetInput
        ? parseTouchTarget(touchTarget)
        : null;
      if (isScreenTouchCommand && hasTouchTargetInput && !normalizedTouchTarget) {
        return res.status(400).json({
          error: "touchTarget must be one of: back, home, recents"
        });
      }

      if (!isScreenTouchCommand && hasTouchTargetInput && !allowsExtraPayloadFields) {
        return res.status(400).json({
          error: "touchTarget is only supported for SCREEN_TOUCH commands"
        });
      }

      const hasAnyTouchPayload =
        hasPresentValue(x) ||
        hasPresentValue(y) ||
        hasPresentValue(screenWidth) ||
        hasPresentValue(screenHeight) ||
        hasPresentValue(startX) ||
        hasPresentValue(startY) ||
        hasPresentValue(endX) ||
        hasPresentValue(endY) ||
        hasPresentValue(durationMs) ||
        hasTouchTargetInput;

      if (!isScreenTouchCommand && !isScreenSwipeCommand && hasAnyTouchPayload && !allowsExtraPayloadFields) {
        return res.status(400).json({
          error:
            "Touch payload fields are only supported for SCREEN_TOUCH and SCREEN_SWIPE commands"
        });
      }

      let normalizedX;
      let normalizedY;
      let normalizedScreenWidth;
      let normalizedScreenHeight;
      let normalizedStartX;
      let normalizedStartY;
      let normalizedEndX;
      let normalizedEndY;
      let normalizedDurationMs;

      if (isScreenTouchCommand) {
        const parsedX = parseNonNegativeCoordinate(x);
        const parsedY = parseNonNegativeCoordinate(y);
        const parsedScreenWidth = parsePositiveDimension(screenWidth);
        const parsedScreenHeight = parsePositiveDimension(screenHeight);
        const hasTapCoordinatesInput =
          hasPresentValue(x) ||
          hasPresentValue(y) ||
          hasPresentValue(screenWidth) ||
          hasPresentValue(screenHeight);

        if (!normalizedTouchTarget) {
          if (
            parsedX === null ||
            parsedY === null ||
            parsedScreenWidth === null ||
            parsedScreenHeight === null
          ) {
            return res.status(400).json({
              error:
                "x, y, screenWidth, and screenHeight are required for SCREEN_TOUCH when touchTarget is not used"
            });
          }
        } else if (
          hasTapCoordinatesInput &&
          (parsedX === null ||
            parsedY === null ||
            parsedScreenWidth === null ||
            parsedScreenHeight === null)
        ) {
          return res.status(400).json({
            error:
              "x, y, screenWidth, and screenHeight must all be valid integers when provided with touchTarget"
          });
        }

        if (
          parsedScreenWidth !== null &&
          parsedScreenHeight !== null &&
          parsedX !== null &&
          parsedY !== null
        ) {
          if (parsedX >= parsedScreenWidth || parsedY >= parsedScreenHeight) {
            return res.status(400).json({
              error:
                "x and y must be within the provided screenWidth and screenHeight bounds"
            });
          }
        }

        normalizedX = parsedX;
        normalizedY = parsedY;
        normalizedScreenWidth = parsedScreenWidth;
        normalizedScreenHeight = parsedScreenHeight;
      }

      if (isScreenSwipeCommand) {
        const parsedStartX = parseNonNegativeCoordinate(startX);
        const parsedStartY = parseNonNegativeCoordinate(startY);
        const parsedEndX = parseNonNegativeCoordinate(endX);
        const parsedEndY = parseNonNegativeCoordinate(endY);
        const parsedDurationMs = parseTouchDurationMs(durationMs);

        if (
          parsedStartX === null ||
          parsedStartY === null ||
          parsedEndX === null ||
          parsedEndY === null ||
          parsedDurationMs === null
        ) {
          return res.status(400).json({
            error:
              "startX, startY, endX, endY, and durationMs are required for SCREEN_SWIPE commands"
          });
        }

        const hasSwipeScreenWidthInput = hasPresentValue(screenWidth);
        const hasSwipeScreenHeightInput = hasPresentValue(screenHeight);
        const parsedSwipeScreenWidth = hasSwipeScreenWidthInput
          ? parsePositiveDimension(screenWidth)
          : null;
        const parsedSwipeScreenHeight = hasSwipeScreenHeightInput
          ? parsePositiveDimension(screenHeight)
          : null;

        if ((hasSwipeScreenWidthInput || hasSwipeScreenHeightInput) &&
          (parsedSwipeScreenWidth === null || parsedSwipeScreenHeight === null)) {
          return res.status(400).json({
            error:
              "screenWidth and screenHeight must both be valid positive integers when provided for SCREEN_SWIPE"
          });
        }

        if (parsedSwipeScreenWidth !== null && parsedSwipeScreenHeight !== null) {
          const allWithinBounds =
            parsedStartX < parsedSwipeScreenWidth &&
            parsedEndX < parsedSwipeScreenWidth &&
            parsedStartY < parsedSwipeScreenHeight &&
            parsedEndY < parsedSwipeScreenHeight;
          if (!allWithinBounds) {
            return res.status(400).json({
              error:
                "start/end coordinates must be within the provided screenWidth and screenHeight bounds"
            });
          }
        }

        normalizedStartX = parsedStartX;
        normalizedStartY = parsedStartY;
        normalizedEndX = parsedEndX;
        normalizedEndY = parsedEndY;
        normalizedDurationMs = parsedDurationMs;
        normalizedScreenWidth = parsedSwipeScreenWidth;
        normalizedScreenHeight = parsedSwipeScreenHeight;
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
        ownerUserId: currentUserId,
        deviceOwnershipEpoch: targetDevice.ownershipEpoch,
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
        addIfPresent(commandData, "subscriptionId", normalizedSubscriptionId);
      } else if (normalizedAction === "sms") {
        addIfPresent(commandData, "phoneNumber", normalizedPhoneNumber);
        addIfPresent(commandData, "message", normalizedMessage);
        addIfPresent(commandData, "subscriptionId", normalizedSubscriptionId);
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
      } else if (normalizedAction === "activate_esim") {
        addIfPresent(commandData, "activationCode", normalizedActivationCode);
      } else if (normalizedAction === "delete_esim") {
        addIfPresent(commandData, "esimSubscriptionId", normalizedEsimSubscriptionId);
        addIfPresent(commandData, "esimPortIndex", normalizedEsimPortIndex);
      } else if (normalizedAction === "screen_touch") {
        addIfPresent(commandData, "x", normalizedX);
        addIfPresent(commandData, "y", normalizedY);
        addIfPresent(commandData, "screenWidth", normalizedScreenWidth);
        addIfPresent(commandData, "screenHeight", normalizedScreenHeight);
        addIfPresent(commandData, "touchTarget", normalizedTouchTarget);
      } else if (normalizedAction === "screen_swipe") {
        addIfPresent(commandData, "startX", normalizedStartX);
        addIfPresent(commandData, "startY", normalizedStartY);
        addIfPresent(commandData, "endX", normalizedEndX);
        addIfPresent(commandData, "endY", normalizedEndY);
        addIfPresent(commandData, "durationMs", normalizedDurationMs);
        addIfPresent(commandData, "screenWidth", normalizedScreenWidth);
        addIfPresent(commandData, "screenHeight", normalizedScreenHeight);
      }

      const shouldCheckDuplicate =
        COMMAND_DUPLICATE_GUARD_WINDOW_MS > 0 &&
        shouldApplyCommandDuplicateGuard(normalizedAction);
      if (shouldCheckDuplicate) {
        const dedupeWindowStart = new Date(Date.now() - COMMAND_DUPLICATE_GUARD_WINDOW_MS);
        const latestRecentCommand = await Command.findOne({
          deviceUid: normalizedDeviceUid,
          ownerUserId: currentUserId,
          deviceOwnershipEpoch: targetDevice.ownershipEpoch,
          createdAt: { $gte: dedupeWindowStart }
        })
          .select("+deviceOwnershipEpoch")
          .sort({ createdAt: -1, _id: -1 });

        if (latestRecentCommand) {
          const incomingCommandSignature = buildCommandDuplicateSignature(commandData);
          const latestCommandSignature = buildCommandDuplicateSignature(latestRecentCommand);
          if (
            incomingCommandSignature &&
            latestCommandSignature &&
            incomingCommandSignature === latestCommandSignature
          ) {
            const latestCommandResponse = mapCommandForResponse(latestRecentCommand);
            logCommandLifecycle("duplicate_ignored", {
              commandId: commandIdFrom(latestRecentCommand),
              deviceUid: normalizedDeviceUid,
              oldStatus: latestCommandResponse.status ?? null,
              newStatus: latestCommandResponse.status ?? null,
              details: {
                action: normalizedAction,
                type: commandType,
                dedupeWindowMs: COMMAND_DUPLICATE_GUARD_WINDOW_MS
              }
            });

            return res.json({
              ...latestCommandResponse,
              duplicateIgnored: true
            });
          }
        }
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
          url: isOpenUrlCommand ? normalizedUrl?.split(/[?#]/, 1)[0] ?? null : null,
          appName: isOpenAppCommand ? normalizedAppName : null,
          resolvedPackageName: isOpenAppCommand ? normalizedResolvedPackageName : null,
          downloadSizeMb: isDownloadDataCommand ? normalizedDownloadSizeMb : null,
          activationCodeLength: isActivateEsimCommand ? normalizedActivationCode.length : null,
          esimSubscriptionId: isDeleteEsimCommand ? normalizedEsimSubscriptionId ?? null : null,
          esimPortIndex: isDeleteEsimCommand ? normalizedEsimPortIndex ?? null : null,
          subscriptionId: isCallOrSmsCommand ? normalizedSubscriptionId ?? null : null,
          x: isScreenTouchCommand ? normalizedX ?? null : null,
          y: isScreenTouchCommand ? normalizedY ?? null : null,
          touchTarget: isScreenTouchCommand ? normalizedTouchTarget ?? null : null,
          startX: isScreenSwipeCommand ? normalizedStartX ?? null : null,
          startY: isScreenSwipeCommand ? normalizedStartY ?? null : null,
          endX: isScreenSwipeCommand ? normalizedEndX ?? null : null,
          endY: isScreenSwipeCommand ? normalizedEndY ?? null : null,
          durationMs: isScreenSwipeCommand ? normalizedDurationMs ?? null : null,
          screenWidth:
            isScreenTouchCommand || isScreenSwipeCommand
              ? normalizedScreenWidth ?? null
              : null,
          screenHeight:
            isScreenTouchCommand || isScreenSwipeCommand
              ? normalizedScreenHeight ?? null
              : null,
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

      const commandResponse = emitCommandCreated(command);
      return res.json(commandResponse);
    } catch (error) {
      return handleServerError(res, error, "POST /commands");
    }
  });

  router.post("/commands/claim", requireAuthenticatedDevice, async (req, res) => {
    try {
      const normalizedDeviceUid = req.deviceUid;
      if (!normalizedDeviceUid) {
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }

      return res.json(
        await claimNextPendingCommandForDevice(normalizedDeviceUid, {
          transport: "http"
        })
      );
    } catch (error) {
      return handleServerError(res, error, "POST /commands/claim");
    }
  });

  router.get("/commands", requireAuth, async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");

      const { deviceUid, status } = req.query;
      const pageSize = parsePositiveIntegerQuery(
        req.query?.limit,
        COMMAND_PAGE_DEFAULT_SIZE,
        COMMAND_PAGE_MAX_SIZE
      );
      const page = parsePositiveIntegerQuery(
        req.query?.page,
        1,
        COMMAND_PAGE_MAX_NUMBER
      );
      if (!pageSize || !page) {
        return res.status(400).json({
          error: `page must be between 1 and ${COMMAND_PAGE_MAX_NUMBER}, and limit must be between 1 and ${COMMAND_PAGE_MAX_SIZE}`
        });
      }
      res.set("X-Page", String(page));
      res.set("X-Page-Size", String(pageSize));
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

        const targetDevice = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
          "+ownershipEpoch"
        );
        if (!targetDevice) {
          return res.status(404).json({ error: "Device not found" });
        }

        if (!targetDevice.ownerUserId) {
          return res.status(403).json({ error: "Device is not claimed" });
        }

        if (!isDeviceOwnedByUser(targetDevice, currentUserId)) {
          return res.status(403).json({ error: "Forbidden" });
        }
        if (!(await ensureDeviceOwnershipEpoch(targetDevice))) {
          return res.status(500).json({ error: "Internal server error" });
        }

        filter.deviceUid = normalizedDeviceUid;
        filter.ownerUserId = currentUserId;
        filter.deviceOwnershipEpoch = targetDevice.ownershipEpoch;
      } else {
        const ownedDevices = await Device.find({
          ownerUserId: currentUserId
        }).select("deviceUid +ownershipEpoch");

        if (!ownedDevices.length) {
          return res.json([]);
        }
        await Promise.all(ownedDevices.map((device) => ensureDeviceOwnershipEpoch(device)));

        filter.ownerUserId = currentUserId;
        filter.$or = ownedDevices.map((device) => ({
          deviceUid: device.deviceUid,
          deviceOwnershipEpoch: device.ownershipEpoch
        }));
      }

      if (status) {
        filter.status = status;
      }

      filter.createdAt = { $gte: last24HoursCutoff };

      const pageOffset = (page - 1) * pageSize;
      const result = await Command.find(filter)
        .sort(COMMAND_DASHBOARD_SORT)
        .skip(pageOffset)
        .limit(pageSize + 1)
        .lean();
      const hasMore = result.length > pageSize;
      const visibleCommands = hasMore ? result.slice(0, pageSize) : result;
      res.set("X-Has-More", hasMore ? "true" : "false");

      logCommandLifecycle("fetched", {
        deviceUid: typeof filter.deviceUid === "string" ? filter.deviceUid : null,
        oldStatus: null,
        newStatus: status ?? null,
        count: visibleCommands.length,
        ids: visibleCommands.map((command) => commandIdFrom(command)),
        details: { page, pageSize, hasMore }
      });

      return res.json(visibleCommands.map(mapCommandForResponse));
    } catch (error) {
      return handleServerError(res, error, "GET /commands");
    }
  });

  router.post("/commands/:id/cancel-and-end", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid command id" });
      }

      const existingCommand = await Command.findById(id).select("+deviceOwnershipEpoch");
      if (!existingCommand) {
        logCommandLifecycle("cancel_pending_missing_command", {
          commandId: id,
          oldStatus: null,
          newStatus: null
        });
        return res.status(404).json({ error: "Command not found" });
      }

      const targetDevice = await Device.findOne({ deviceUid: existingCommand.deviceUid }).select(
        "+ownershipEpoch"
      );
      if (!targetDevice) {
        return res.status(404).json({ error: "Device not found" });
      }

      if (!targetDevice.ownerUserId) {
        return res.status(403).json({ error: "Device is not claimed" });
      }

      if (!isDeviceOwnedByUser(targetDevice, currentUserId)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!(await ensureDeviceOwnershipEpoch(targetDevice))) {
        return res.status(500).json({ error: "Internal server error" });
      }
      if (!commandMatchesDeviceOwnership(existingCommand, targetDevice, currentUserId)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const cancelledFailureReason = "Cancelled by user before execution";
      const cancelledCommand = await Command.findOneAndUpdate(
        {
          _id: existingCommand._id,
          ownerUserId: currentUserId,
          deviceOwnershipEpoch: targetDevice.ownershipEpoch,
          status: "pending"
        },
        {
          $set: {
            status: "cancelled",
            failureReason: cancelledFailureReason
          },
          $unset: {
            executedAt: 1,
            downloadDurationSeconds: 1
          }
        },
        { new: true }
      );

      if (!cancelledCommand) {
        const latestCommand = await Command.findById(existingCommand._id);
        const latestStatus = latestCommand?.status ?? "unknown";
        return res.status(409).json({
          error: `Only pending commands can be cancelled. Current status: ${latestStatus}`
        });
      }

      logCommandLifecycle("cancelled_by_user", {
        commandId: commandIdFrom(cancelledCommand),
        deviceUid: cancelledCommand.deviceUid,
        oldStatus: "pending",
        newStatus: "cancelled",
        details: {
          hasFailureReason: true
        }
      });

      const cancelledCommandResponse = emitCommandUpdated(cancelledCommand, { notifyDevice: true });
      const cancelledIsEndCommand =
        cancelledCommand.action === "end" || cancelledCommand.type === "END";
      let endCommand = null;
      let endCommandResponse = null;
      if (!cancelledIsEndCommand) {
        const cancelledCommandId = commandIdFrom(cancelledCommand) || id;
        endCommand = await Command.create({
          deviceUid: cancelledCommand.deviceUid,
          ownerUserId: currentUserId,
          deviceOwnershipEpoch: targetDevice.ownershipEpoch,
          action: "end",
          type: "END",
          status: "pending",
          isImmediate: true,
          notes: `Auto END after cancelling command ${cancelledCommandId}`,
          createdAt: new Date(toUtcISOString())
        });

        logCommandLifecycle("created", {
          commandId: commandIdFrom(endCommand),
          deviceUid: endCommand.deviceUid,
          oldStatus: null,
          newStatus: "pending",
          details: {
            action: "end",
            type: "END",
            trigger: "cancel_and_end",
            canceledCommandId: cancelledCommandId
          }
        });

        endCommandResponse = emitCommandCreated(endCommand);
      }

      return res.json({
        success: true,
        cancelledCommand: cancelledCommandResponse,
        endCommand: endCommandResponse
      });
    } catch (error) {
      return handleServerError(res, error, "POST /commands/:id/cancel-and-end");
    }
  });

  router.delete("/commands", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const ownedDevices = await Device.find({
        ownerUserId: currentUserId
      }).select("deviceUid +ownershipEpoch");

      if (!ownedDevices.length) {
        return res.json({
          success: true,
          message: "All your commands cleared",
          deletedCount: 0
        });
      }

      await Promise.all(ownedDevices.map((device) => ensureDeviceOwnershipEpoch(device)));
      const ownedDeviceUids = ownedDevices.map((device) => device.deviceUid);
      const deletionResult = await Command.deleteMany({
        ownerUserId: currentUserId,
        $or: ownedDevices.map((device) => ({
          deviceUid: device.deviceUid,
          deviceOwnershipEpoch: device.ownershipEpoch
        }))
      });
      const deletedCount = Number(deletionResult?.deletedCount || 0);
      emitCommandsCleared(ownedDeviceUids, deletedCount);

      return res.json({
        success: true,
        message: "All your commands cleared",
        deletedCount
      });
    } catch (error) {
      return handleServerError(res, error, "DELETE /commands");
    }
  });

  router.post("/commands/:id/status", requireAuthenticatedDevice, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, failureReason, downloadDurationSeconds } = req.body;
      console.log("[CommandStatus] Callback received", {
        commandId: id,
        deviceUid: req.deviceUid ?? null,
        status:
          typeof status === "string"
            ? status.trim().toLowerCase().slice(0, 32)
            : status === undefined || status === null
              ? null
              : typeof status,
        hasFailureReason: typeof failureReason === "string" && failureReason.trim() !== "",
        downloadDurationSeconds: Number.isFinite(Number(downloadDurationSeconds))
          ? Number(downloadDurationSeconds)
          : downloadDurationSeconds === undefined || downloadDurationSeconds === null
            ? null
            : typeof downloadDurationSeconds
      });

      const command = mongoose.isValidObjectId(id)
        ? await Command.findById(id).select("+deviceOwnershipEpoch")
        : null;

      if (!command) {
        logCommandLifecycle("status_update_missing_command", {
          commandId: id,
          oldStatus: null,
          newStatus: typeof status === "string" ? status.trim().toLowerCase().slice(0, 32) : null
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
      if (!commandMatchesDeviceOwnership(command, req.authenticatedDevice)) {
        logSecurityEvent("command_status_update_forbidden_stale_ownership", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          commandId: id,
          deviceUid: authenticatedDeviceUid
        });
        return res.status(403).json({ error: "Forbidden" });
      }

      const normalizedStatus =
        typeof status === "string" ? status.trim().toLowerCase() : "";
      const validStatuses = new Set(["pending", "executing", "executed", "failed", "cancelled"]);

      if (!validStatuses.has(normalizedStatus)) {
        console.warn("[CommandStatus] Invalid status callback rejected", {
          commandId: id,
          deviceUid: req.deviceUid ?? null,
          status: normalizedStatus || typeof status
        });
        return res.status(400).json({
          error: "Invalid status. Only 'pending', 'executing', 'executed', 'failed', and 'cancelled' are supported."
        });
      }

      const allowedTransitions = {
        pending: new Set(["pending", "executing", "executed", "failed", "cancelled"]),
        executing: new Set(["executing", "executed", "failed", "cancelled"]),
        executed: new Set(["executed"]),
        failed: new Set(["failed"]),
        cancelled: new Set(["cancelled"])
      };

      const canTransition = allowedTransitions[command.status]?.has(normalizedStatus);
      if (!canTransition) {
        logCommandLifecycle("status_transition_ignored", {
          commandId: commandIdFrom(command),
          deviceUid: command.deviceUid,
          oldStatus: command.status,
          newStatus: normalizedStatus
        });
        return res.json(emitCommandUpdated(command));
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
      } else if (normalizedStatus === "failed" || normalizedStatus === "cancelled") {
        const normalizedFailureReason =
          typeof failureReason === "string" ? failureReason.trim() : "";
        if (normalizedFailureReason.length > 1000) {
          return res.status(400).json({
            error: "failureReason must not exceed 1000 characters"
          });
        }
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
      const commandResponse = emitCommandUpdated(command);

      if (["executed", "failed", "cancelled"].includes(normalizedStatus)) {
        try {
          await CommandCollectionService.handleCommandStatusChange(
            command._id.toString(),
            normalizedStatus,
            command.failureReason,
            command
          );
        } catch (collectionError) {
          console.error("[CommandStatus] Collection status hook failed after command save", {
            commandId: commandIdFrom(command),
            status: normalizedStatus,
            ...safeErrorMetadata(collectionError)
          });
        }
      }

      logCommandLifecycle("status_updated", {
        commandId: commandIdFrom(command),
        deviceUid: command.deviceUid,
        oldStatus: previousStatus,
        newStatus: normalizedStatus,
        details: {
          hasFailureReason:
            (normalizedStatus === "failed" || normalizedStatus === "cancelled") &&
            Boolean(command.failureReason),
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
          hasFailureReason:
            (normalizedStatus === "failed" || normalizedStatus === "cancelled") &&
            Boolean(command.failureReason)
        });
      }

      return res.json(commandResponse);
    } catch (error) {
      return handleServerError(res, error, "POST /commands/:id/status");
    }
  });

  // Helpers internal to router
  return router;
}

module.exports = createCommandsRouter;
