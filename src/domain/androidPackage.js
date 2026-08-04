const ANDROID_PACKAGE_REGEX = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/;

function isValidAndroidPackageName(value) {
  return typeof value === "string" && ANDROID_PACKAGE_REGEX.test(value.trim());
}

module.exports = {
  ANDROID_PACKAGE_REGEX,
  isValidAndroidPackageName
};
