const { normalizeDeviceUid } = require("../domain/deviceUid");

function createDeviceSessionRevoker({
  io,
  unregisterDeviceSocketConnection,
  emitDevicePresenceStatus,
  logSecurityEvent
}) {
  if (!io || typeof io.in !== "function") {
    throw new TypeError("A Socket.IO server is required");
  }

  return async function revokeDeviceSessions(deviceUid, reason = "device_session_revoked") {
    const normalizedDeviceUid = normalizeDeviceUid(deviceUid);
    if (!normalizedDeviceUid) return 0;

    const pendingRoom = io.in(`device-pending:${normalizedDeviceUid}`);
    const activeRoom = io.in(`device:${normalizedDeviceUid}`);
    let pendingSockets = [];
    let activeSockets = [];
    try {
      [pendingSockets, activeSockets] = await Promise.all([
        pendingRoom.fetchSockets(),
        activeRoom.fetchSockets()
      ]);
    } catch (error) {
      // Enumeration is used for the notification and audit count. Revocation
      // itself still proceeds through the adapter-aware room operations below.
      logSecurityEvent?.("device_session_enumeration_failed", {
        deviceUid: normalizedDeviceUid,
        reason,
        errorName: error?.name || "Error"
      });
    }
    const socketsById = new Map(
      [...pendingSockets, ...activeSockets].map((socket) => [socket.id, socket])
    );
    const deviceSockets = [...socketsById.values()].filter(
      (socket) =>
        socket?.data?.authType === "device" &&
        normalizeDeviceUid(socket.data.authenticatedDeviceUid) === normalizedDeviceUid
    );

    for (const socket of deviceSockets) {
      try {
        socket.emit("security:error", {
          event: "device:session-revoked",
          reason
        });
      } catch (_error) {
        // Notification is best effort; it must never prevent disconnection.
      }
    }

    await Promise.allSettled(
      deviceSockets.map((socket) => Promise.resolve().then(() => socket.disconnect(true)))
    );

    // Disconnect pending sockets first, then active sockets. This ordering closes
    // the race where a handshake is promoted into the command room while a
    // distributed revocation is in progress.
    let roomDisconnectError = null;
    for (const room of [pendingRoom, activeRoom]) {
      try {
        room.disconnectSockets(true);
      } catch (error) {
        roomDisconnectError ??= error;
      }
    }

    for (const socket of deviceSockets) {
      unregisterDeviceSocketConnection?.(socket.id);
    }
    emitDevicePresenceStatus?.(normalizedDeviceUid);
    logSecurityEvent?.("device_sessions_revoked", {
      deviceUid: normalizedDeviceUid,
      reason,
      disconnectedSocketCount: deviceSockets.length
    });

    if (roomDisconnectError) throw roomDisconnectError;

    return deviceSockets.length;
  };
}

module.exports = { createDeviceSessionRevoker };
