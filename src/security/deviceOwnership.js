const crypto = require("crypto");
const Device = require("../models/Device");

async function ensureDeviceOwnershipEpoch(device) {
  if (!device?._id) return "";

  const hasPersistedEpoch =
    typeof device.ownershipEpoch === "string" &&
    device.ownershipEpoch.trim() !== "" &&
    !(typeof device.$isDefault === "function" && device.$isDefault("ownershipEpoch"));
  if (hasPersistedEpoch) return device.ownershipEpoch;

  const candidateEpoch = crypto.randomUUID();
  const initializedDevice = await Device.findOneAndUpdate(
    {
      _id: device._id,
      $or: [
        { ownershipEpoch: { $exists: false } },
        { ownershipEpoch: null },
        { ownershipEpoch: "" }
      ]
    },
    { $set: { ownershipEpoch: candidateEpoch } },
    { new: true }
  ).select("+ownershipEpoch");

  if (initializedDevice?.ownershipEpoch) {
    device.ownershipEpoch = initializedDevice.ownershipEpoch;
    return initializedDevice.ownershipEpoch;
  }

  const currentDevice = await Device.findById(device._id).select("+ownershipEpoch");
  if (currentDevice?.ownershipEpoch) {
    device.ownershipEpoch = currentDevice.ownershipEpoch;
    return currentDevice.ownershipEpoch;
  }

  return "";
}

module.exports = { ensureDeviceOwnershipEpoch };
