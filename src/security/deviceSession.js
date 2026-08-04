const crypto = require("crypto");
const Device = require("../models/Device");

async function ensureDeviceSessionEpoch(device) {
  if (!device?._id) return "";

  const hasPersistedEpoch =
    typeof device.deviceSessionEpoch === "string" &&
    device.deviceSessionEpoch.trim() !== "" &&
    !(typeof device.$isDefault === "function" && device.$isDefault("deviceSessionEpoch"));
  if (hasPersistedEpoch) return device.deviceSessionEpoch;

  const candidateEpoch = crypto.randomUUID();
  const initializedDevice = await Device.findOneAndUpdate(
    {
      _id: device._id,
      $or: [
        { deviceSessionEpoch: { $exists: false } },
        { deviceSessionEpoch: null },
        { deviceSessionEpoch: "" }
      ]
    },
    { $set: { deviceSessionEpoch: candidateEpoch } },
    { new: true }
  ).select("+deviceSessionEpoch");

  if (initializedDevice?.deviceSessionEpoch) {
    device.deviceSessionEpoch = initializedDevice.deviceSessionEpoch;
    return initializedDevice.deviceSessionEpoch;
  }

  const currentDevice = await Device.findById(device._id).select("+deviceSessionEpoch");
  if (currentDevice?.deviceSessionEpoch) {
    device.deviceSessionEpoch = currentDevice.deviceSessionEpoch;
    return currentDevice.deviceSessionEpoch;
  }

  return "";
}

module.exports = { ensureDeviceSessionEpoch };
