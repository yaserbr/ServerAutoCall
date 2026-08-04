const { normalizeDeviceUid } = require("../domain/deviceUid");
const { toPlainObject } = require("../utils/objects");

function createCommandEventService({ io, formatUtcForRiyadhDisplay }) {
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
    if (!deviceUid) return commandResponse;

    if (options.notifyDevice !== false) {
      io.to(`device:${deviceUid}`).emit("command:new", commandResponse);
    }
    io.to(`dashboard:${deviceUid}`).emit("command:created", commandResponse);
    return commandResponse;
  }

  function emitCommandUpdated(command, options = {}) {
    const commandResponse = mapCommandForResponse(command);
    const deviceUid = normalizeDeviceUid(commandResponse.deviceUid);
    if (!deviceUid) return commandResponse;

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

    if (!normalizedDeviceUids.length) return;

    const payload = {
      deviceUids: normalizedDeviceUids,
      deletedCount: Number(deletedCount || 0)
    };

    normalizedDeviceUids.forEach((deviceUid) => {
      io.to(`device:${deviceUid}`).emit("commands:cleared", payload);
      io.to(`dashboard:${deviceUid}`).emit("commands:cleared", payload);
    });
  }

  return {
    mapCommandForResponse,
    emitCommandCreated,
    emitCommandUpdated,
    emitCommandsCleared
  };
}

module.exports = createCommandEventService;
