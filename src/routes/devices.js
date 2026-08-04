const express = require("express");
const crypto = require("crypto");
const { safeErrorMetadata } = require("../security/safeError");

/**
 * Creates and configures the Devices router.
 * Uses dependency injection to access models, middlewares, and helper utilities.
 */
function createDevicesRouter({
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
  revokeDashboardAccessForDevice,
  revokeDeviceSessions,
  deviceEnrollmentRateLimiter
}) {
  const router = express.Router();

  router.post("/devices/register", async (req, res) => {
    try {
      const { payload, normalizedDeviceUid, normalizedDeviceName, normalizedPlatform } =
        extractDeviceRegistrationInput(req.body);
      const hasEsimSubscriptionsPayload = Array.isArray(payload?.esimSubscriptions);
      const normalizedEsimSubscriptions = hasEsimSubscriptionsPayload
        ? normalizeEsimSubscriptions(payload.esimSubscriptions)
        : null;
      const requestInfo = {
        contentType: req.headers["content-type"] ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        keys: Object.keys(payload || {})
      };
      console.log("[DeviceRegister] Incoming request:", requestInfo);

      if (!normalizedDeviceUid) {
        console.warn("[DeviceRegister] Validation failed: deviceUid is missing/empty", requestInfo);
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }

      const providedDeviceToken = extractDeviceTokenFromRequest(req);
      const now = new Date(toUtcISOString());
      const device = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
        "+deviceTokenHash +ownershipEpoch"
      );

      // Initial enrollment is intentionally not performed by this endpoint.
      // A new device must consume the short-lived, single-use pairing challenge
      // through /devices/pair before the server will mint a device credential.
      if (!device) {
        logSecurityEvent("anonymous_device_registration_rejected", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          deviceUid: normalizedDeviceUid
        });
        return res.status(401).json({
          error: "Unauthorized",
          code: "device_enrollment_required"
        });
      }

      if (device.deviceTokenHash) {
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
      } else {
        logSecurityEvent("device_register_rejected_missing_server_token", {
          ip: req.ip,
          path: req.originalUrl,
          method: req.method,
          deviceUid: normalizedDeviceUid
        });
        return res.status(401).json({
          error: "Unauthorized",
          code: "device_enrollment_required"
        });
      }

      device.online = true;
      device.lastSeen = now;

      if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName =
          normalizedDeviceName ?? buildDefaultDeviceName(normalizedDeviceUid);
      } else if (device.deviceName === buildDefaultDeviceName(normalizedDeviceUid) && normalizedDeviceName) {
        device.deviceName = normalizedDeviceName;
      }

      if (normalizedPlatform) {
        device.platform = normalizedPlatform;
      }
      if (hasEsimSubscriptionsPayload) {
        device.esimSubscriptions = normalizedEsimSubscriptions;
      }

      await device.save();

      console.log("[DeviceRegister] Registration success:", {
        deviceUid: normalizedDeviceUid,
        mode: "updated_existing",
        platform: device.platform ?? null
      });
      const mappedDevice = await mapDeviceForResponseWithLinkedAccount(device);

      return res.json({
        success: true,
        device: mappedDevice
      });
    } catch (error) {
      console.error("[DeviceRegister] Registration failed:", {
        ...safeErrorMetadata(error)
      });
      return handleServerError(res, error, "POST /devices/register");
    }
  });

  router.post("/devices/heartbeat", requireAuthenticatedDevice, async (req, res) => {
    try {
      const { payload } = extractDeviceRegistrationInput(req.body);
      const hasEsimSubscriptionsPayload = Array.isArray(payload?.esimSubscriptions);
      const normalizedEsimSubscriptions = hasEsimSubscriptionsPayload
        ? normalizeEsimSubscriptions(payload.esimSubscriptions)
        : null;
      const normalizedDeviceUid = req.deviceUid;
      const device = req.authenticatedDevice;
      console.log("[DeviceHeartbeat] Incoming request:", {
        contentType: req.headers["content-type"] ?? null,
        userAgent: req.headers["user-agent"] ?? null,
        keys: Object.keys(payload || {})
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

      device.online = true;
      device.lastSeen = new Date(toUtcISOString());

      if (!normalizeDeviceName(device.deviceName)) {
        device.deviceName = buildDefaultDeviceName(normalizedDeviceUid);
      }
      if (hasEsimSubscriptionsPayload) {
        device.esimSubscriptions = normalizedEsimSubscriptions;
      }

      await device.save();
      console.log("[DeviceHeartbeat] Updated existing device:", {
        deviceUid: normalizedDeviceUid
      });
      const mappedDevice = await mapDeviceForResponseWithLinkedAccount(device);

      return res.json({
        success: true,
        device: mappedDevice
      });
    } catch (error) {
      return handleServerError(res, error, "POST /devices/heartbeat");
    }
  });

  router.post("/devices/token/rotate", requireAuthenticatedDevice, async (req, res) => {
    try {
      const normalizedDeviceUid = req.deviceUid;
      const device = req.authenticatedDevice;
      if (!normalizedDeviceUid || !device) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // A new session epoch makes the credential generation explicit. The HTTP
      // token is replaced first, then every socket authenticated by the previous
      // generation is disconnected before the new token is returned.
      device.deviceSessionEpoch = crypto.randomUUID();
      const deviceToken = issueDeviceTokenForDevice(device);
      await device.save();
      await revokeDeviceSessions(normalizedDeviceUid, "device_token_rotated");

      res.set("Cache-Control", "no-store");
      return res.json({ success: true, deviceToken });
    } catch (error) {
      return handleServerError(res, error, "POST /devices/token/rotate");
    }
  });

  router.get("/devices", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const includeUnclaimed = parseIncludeUnclaimedQueryValue(req.query?.unclaimed);
      const devices = await Device.find({
        ...(includeUnclaimed
          ? { $or: [{ ownerUserId: currentUserId }, { ownerUserId: null }] }
          : { ownerUserId: currentUserId })
      }).lean();
      const mappedDevices = await mapDeviceListForResponseWithLinkedAccount(devices);
      const ownershipScopedDevices = mappedDevices.map((mappedDevice, index) => {
        const sourceDevice = devices[index];
        if (isDeviceOwnedByUser(sourceDevice, currentUserId)) return mappedDevice;
        return {
          ...mappedDevice,
          linkedAccount: null,
          esimSubscriptions: []
        };
      });

      return res.json(ownershipScopedDevices);
    } catch (error) {
      return handleServerError(res, error, "GET /devices");
    }
  });

  router.post("/devices/pair", deviceEnrollmentRateLimiter, async (req, res) => {
    try {
      const payload = parseRequestBodyObject(req.body);
      const normalizedPairingToken = normalizePairingToken(payload?.pairingToken);
      const normalizedPairingCode = normalizeManualPairingCode(payload?.pairingCode);
      const normalizedDeviceUid = normalizeDeviceUid(payload?.deviceUid);
      const normalizedDeviceName = normalizeDeviceName(payload?.deviceName);
      const normalizedPlatform = normalizeDeviceName(payload?.platform);
      const providedDeviceToken = extractDeviceTokenFromRequest(req);

      if (!normalizedDeviceUid) {
        return res.status(400).json({ error: DEVICE_UID_FORMAT_ERROR });
      }

      const pairingInspection = await inspectPairingCredential(
        normalizedPairingToken,
        normalizedPairingCode
      );
      if (!pairingInspection.ok) {
        return res
          .status(getPairingCredentialFailureHttpStatus(pairingInspection.reason))
          .json({ error: getPairingCredentialFailureMessage(pairingInspection.reason) });
      }

      const pairingCredentialType = pairingInspection.credentialType === "code" ? "code" : "token";
      const ownerUserId = normalizeAuthUserId(pairingInspection.userId);
      if (!ownerUserId) {
        return res
          .status(400)
          .json({
            error:
              pairingCredentialType === "code" ? "Invalid pairing code" : "Invalid pairing token"
          });
      }

      const ownerUserExists = await User.exists({ _id: ownerUserId });
      if (!ownerUserExists) {
        return res.status(404).json({ error: "Pairing token user not found" });
      }

      let device = await Device.findOne({ deviceUid: normalizedDeviceUid }).select(
        "+deviceTokenHash +ownershipEpoch"
      );
      if (pairingCredentialType === "code") {
        if (!providedDeviceToken) {
          return res.status(401).json({ error: "Unauthorized" });
        }
        if (!device?.deviceTokenHash) {
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      if (device?.deviceTokenHash) {
        const canAuthenticate = isDeviceTokenMatch(providedDeviceToken, device.deviceTokenHash);
        if (!canAuthenticate) {
          logSecurityEvent("device_pair_rejected_bad_token", {
            ip: req.ip,
            path: req.originalUrl,
            method: req.method,
            deviceUid: normalizedDeviceUid
          });
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      // Atomic consumption happens before token issuance, so replayed or
      // concurrent uses of the same challenge cannot mint another credential.
      const consumeResult = await consumePairingTokenByHash(
        pairingInspection.tokenHash,
        normalizedDeviceUid
      );
      if (!consumeResult.ok) {
        const reasonForResponse =
          pairingCredentialType === "code"
            ? translatePairingTokenReasonToCodeReason(consumeResult.reason)
            : consumeResult.reason;
        return res
          .status(getPairingCredentialFailureHttpStatus(reasonForResponse))
          .json({ error: getPairingCredentialFailureMessageForType(consumeResult.reason, pairingCredentialType) });
      }

      const now = new Date(toUtcISOString());
      let issuedDeviceToken = null;
      const previousOwnerUserId = device?.ownerUserId ? String(device.ownerUserId) : "";
      const ownershipChanged = previousOwnerUserId !== String(ownerUserId);

      if (!device) {
        device = new Device({
          deviceUid: normalizedDeviceUid,
          deviceName: normalizedDeviceName ?? buildDefaultDeviceName(normalizedDeviceUid),
          platform: normalizedPlatform,
          online: true,
          ownerUserId,
          ownershipEpoch: crypto.randomUUID(),
          claimedAt: now,
          lastSeen: now
        });
      } else {
        device.online = true;
        device.lastSeen = now;
        device.ownerUserId = ownerUserId;
        if (ownershipChanged) {
          device.ownershipEpoch = crypto.randomUUID();
        }
        device.claimedAt = now;

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
        if (providedDeviceToken) {
          device.deviceTokenHash = hashDeviceToken(providedDeviceToken);
          device.deviceTokenIssuedAt = now;
        } else {
          issuedDeviceToken = issueDeviceTokenForDevice(device);
        }
      }

      await device.save();
      if (ownershipChanged) {
        await revokeDashboardAccessForDevice(normalizedDeviceUid, ownerUserId);
      }

      const mappedDevice = await mapDeviceForResponseWithLinkedAccount(device);

      return res.json({
        success: true,
        message: "Device paired successfully",
        device: mappedDevice,
        ...(issuedDeviceToken ? { deviceToken: issuedDeviceToken } : {})
      });
    } catch (error) {
      return handleServerError(res, error, "POST /devices/pair");
    }
  });

  router.post("/devices/unclaim", requireAuth, async (req, res) => {
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
      device.ownershipEpoch = crypto.randomUUID();
      device.claimedAt = null;
      await device.save();
      await revokeDashboardAccessForDevice(normalizedDeviceUid, null);

      return res.json({ success: true, device: mapDeviceForResponse(device) });
    } catch (error) {
      return handleServerError(res, error, "POST /devices/unclaim");
    }
  });

  router.delete("/devices/:deviceUid", requireAuth, async (req, res) => {
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
      await revokeDeviceSessions(normalizedDeviceUid, "device_deleted");
      await revokeDashboardAccessForDevice(normalizedDeviceUid, null);

      return res.json({
        success: true,
        message: "Device deleted",
        device: mapDeviceForResponse(device)
      });
    } catch (error) {
      return handleServerError(res, error, "DELETE /devices/:deviceUid");
    }
  });

  router.post("/devices/rename", requireAuth, async (req, res) => {
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

  return router;
}

module.exports = createDevicesRouter;
