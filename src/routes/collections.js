const express = require("express");
const { ensureDeviceOwnershipEpoch } = require("../security/deviceOwnership");

function createCollectionsRouter({
  Device,
  CollectionTemplate,
  CommandCollectionService,
  requireAuth,
  normalizeDeviceUid,
  normalizeAuthUserId,
  isDeviceOwnedByUser,
  formatUtcForRiyadhDisplay,
  handleServerError,
  DEVICE_UID_FORMAT_ERROR
}) {
  const router = express.Router();

  router.post("/collections", requireAuth, async (req, res) => {
    try {
      const { name, deviceUid, commandTemplates } = req.body;

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
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Collection name is required and must be a non-empty string" });
      }
      if (!Array.isArray(commandTemplates) || commandTemplates.length === 0) {
        return res.status(400).json({ error: "commandTemplates is required and must be a non-empty array" });
      }

      const collection = await CommandCollectionService.createAndStartCollection(
        name,
        normalizedDeviceUid,
        commandTemplates,
        currentUserId
      );

      return res.status(201).json({
        success: true,
        collection: {
          id: String(collection._id),
          name: collection.name,
          deviceUid: collection.deviceUid,
          status: collection.status,
          currentIndex: collection.currentIndex,
          createdAt: formatUtcForRiyadhDisplay(collection.createdAt),
          completedAt: formatUtcForRiyadhDisplay(collection.completedAt),
          commandTemplates: collection.commandTemplates,
          activeCommandIds: collection.activeCommandIds
        }
      });
    } catch (error) {
      if (error?.statusCode === 400) {
        return res.status(400).json({ error: error.message });
      }
      return handleServerError(res, error, "POST /collections");
    }
  });

  router.get("/collection-templates", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const templates = await CollectionTemplate.find({ ownerUserId: currentUserId })
        .sort({ name: 1 })
        .lean();
      return res.json(templates);
    } catch (error) {
      return handleServerError(res, error, "GET /collection-templates");
    }
  });

  router.post("/collection-templates", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { name, commandTemplates } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Template name is required and must be a non-empty string" });
      }
      if (!Array.isArray(commandTemplates) || commandTemplates.length === 0) {
        return res.status(400).json({ error: "commandTemplates is required and must be a non-empty array" });
      }

      const processedTemplates = commandTemplates.map((tmpl, idx) => {
        if (!tmpl.action) {
          throw new Error(`Command template at index ${idx} is missing 'action' field.`);
        }

        const action = String(tmpl.action).trim().toLowerCase();
        const type = tmpl.type ? String(tmpl.type).trim().toUpperCase() : action.toUpperCase();
        const delayAfterSeconds = CommandCollectionService.normalizeDelayAfterSeconds(
          tmpl.delayAfterSeconds,
          idx
        );

        return { ...tmpl, action, type, delayAfterSeconds };
      });

      let template = await CollectionTemplate.findOne({
        ownerUserId: currentUserId,
        name: name.trim()
      });
      if (template) {
        template.commandTemplates = processedTemplates;
        await template.save();
      } else {
        template = await CollectionTemplate.create({
          ownerUserId: currentUserId,
          name: name.trim(),
          commandTemplates: processedTemplates
        });
      }

      return res.status(201).json(template);
    } catch (error) {
      if (error.statusCode === 400 || error.message?.includes("missing 'action' field")) {
        return res.status(400).json({ error: error.message });
      }
      return handleServerError(res, error, "POST /collection-templates");
    }
  });

  router.delete("/collection-templates/:id", requireAuth, async (req, res) => {
    try {
      const currentUserId = normalizeAuthUserId(req.user?.id);
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "Template ID is required" });
      }

      const deletedTemplate = await CollectionTemplate.findOneAndDelete({
        _id: id,
        ownerUserId: currentUserId
      });
      if (!deletedTemplate) {
        return res.status(404).json({ error: "Template not found or not owned by you" });
      }

      return res.json({
        success: true,
        message: "Template deleted successfully",
        deletedId: id
      });
    } catch (error) {
      return handleServerError(res, error, "DELETE /collection-templates/:id");
    }
  });

  return router;
}

module.exports = createCollectionsRouter;
