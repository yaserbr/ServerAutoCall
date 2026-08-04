const express = require("express");
const mongoose = require("mongoose");

function createContactsRouter({ Contact, requireAuth, normalizeAuthUserId, handleServerError }) {
  const router = express.Router();

  router.get(["/contacts", "/api/contacts"], requireAuth, async (req, res) => {
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

  router.post(["/contacts", "/api/contacts"], requireAuth, async (req, res) => {
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
        $or: [{ phoneNumber: trimmedPhoneNumber }, { name: trimmedName }]
      }).limit(2);

      let contact = matchingContacts.find(
        (candidate) => candidate.phoneNumber === trimmedPhoneNumber
      );

      if (contact) {
        contact.name = trimmedName;
        await contact.save();
      } else {
        contact = matchingContacts.find((candidate) => candidate.name === trimmedName);
        if (contact) {
          contact.phoneNumber = trimmedPhoneNumber;
          await contact.save();
        } else {
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

  router.delete(["/contacts/:id", "/api/contacts/:id"], requireAuth, async (req, res) => {
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

      return res.json({
        success: true,
        message: "Contact deleted successfully",
        contact: deletedContact
      });
    } catch (error) {
      return handleServerError(res, error, "DELETE /contacts/:id");
    }
  });

  return router;
}

module.exports = createContactsRouter;
