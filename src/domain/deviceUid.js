const DEVICE_UID_LENGTH = 5;
const DEVICE_UID_REGEX = new RegExp(`^[a-z0-9]{${DEVICE_UID_LENGTH}}$`);
const DEVICE_UID_FORMAT_ERROR =
  `deviceUid must be exactly ${DEVICE_UID_LENGTH} lowercase letters or digits`;

function normalizeDeviceUid(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim().toLowerCase();
  return DEVICE_UID_REGEX.test(normalized) ? normalized : "";
}

module.exports = {
  DEVICE_UID_LENGTH,
  DEVICE_UID_REGEX,
  DEVICE_UID_FORMAT_ERROR,
  normalizeDeviceUid
};
