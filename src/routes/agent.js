const express = require("express");
const { ensureDeviceOwnershipEpoch } = require("../security/deviceOwnership");
const { commandIdFrom } = require("../utils/objects");

function createAgentRouter({
  Device,
  Contact,
  CollectionTemplate,
  Command,
  CommandCollectionService,
  requireAuth,
  normalizeAuthUserId,
  normalizeAgentHistory,
  buildDefaultDeviceName,
  isDeviceOnlineBySocket,
  normalizeDeviceUid,
  runAgentOrchestrator,
  escapeRegexLiteral,
  buildValidatedAgentCommandData,
  logSecurityEvent,
  logCommandLifecycle,
  emitCommandCreated,
  handleServerError,
  RIYADH_TIMEZONE,
  AGENT_MESSAGE_MAX_LENGTH
}) {
  const router = express.Router();

  router.post("/agent/chat", requireAuth, async (req, res) => {
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

      const devices = await Device.find({ ownerUserId: currentUserId }).select("+ownershipEpoch");
      await Promise.all(devices.map((device) => ensureDeviceOwnershipEpoch(device)));
      const formattedDevices = devices.map((device) => ({
        deviceUid: device.deviceUid,
        deviceName: device.deviceName || buildDefaultDeviceName(device.deviceUid),
        platform: device.platform,
        online: isDeviceOnlineBySocket(device.deviceUid)
      }));

      if (formattedDevices.length === 0) {
        return res.json({
          response: "I couldn't find any paired devices for your account. Please pair a device first to execute automation commands.",
          status: "no_devices",
          draftCommand: null
        });
      }

      const capitalizedWords = (normalizedMessage.match(/[A-Z][a-z]+/g) || []).map((word) =>
        word.trim()
      );
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
        contacts = await Contact.find({ userId: currentUserId })
          .sort({ name: 1 })
          .limit(10)
          .lean();
      }

      let selectedDeviceUid = normalizeDeviceUid(req.body.deviceUid);
      if (!selectedDeviceUid && formattedDevices.length > 0) {
        const onlineDevice = formattedDevices.find((device) => device.online);
        selectedDeviceUid = onlineDevice
          ? onlineDevice.deviceUid
          : formattedDevices[0].deviceUid;
      }

      const agentResult = await runAgentOrchestrator({
        prompt: normalizedMessage,
        history: normalizedHistory,
        contacts: contacts.map((contact) => ({
          name: contact.name,
          phoneNumber: contact.phoneNumber
        })),
        devices: formattedDevices,
        timezone: RIYADH_TIMEZONE,
        currentTime: new Date().toISOString(),
        activeDeviceUid: selectedDeviceUid
      });

      if (agentResult.draftCommand) {
        const targetDevice = devices.find(
          (device) => device.deviceUid === agentResult.draftCommand.deviceUid
        );
        if (!targetDevice) {
          return res.status(400).json({
            error: "Agent targeted an invalid or unauthorized deviceUid.",
            response: "I apologize, but I couldn't target the requested device safely.",
            draftCommand: null
          });
        }

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

      return res.json({
        response: agentResult.response,
        status: "conversation",
        draftCommand: null
      });
    } catch (error) {
      return handleServerError(res, error, "POST /agent/chat");
    }
  });

  return router;
}

module.exports = createAgentRouter;
