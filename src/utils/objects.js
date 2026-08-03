/**
 * Utility functions for object and value manipulation.
 */

function hasPresentValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

function addIfPresent(obj, key, value) {
  if (!obj || typeof obj !== "object") return;
  if (hasPresentValue(value)) {
    obj[key] = value;
  }
}

function unsetIfPresent(document, key) {
  if (!document || typeof document.get !== "function" || typeof document.set !== "function") {
    return;
  }

  if (document.get(key) !== undefined) {
    document.set(key, undefined);
  }
}

function toPlainObject(documentOrObject) {
  if (!documentOrObject) return documentOrObject;
  if (typeof documentOrObject.toObject === "function") {
    return documentOrObject.toObject();
  }
  return documentOrObject;
}

function commandIdFrom(commandOrObject) {
  const source = toPlainObject(commandOrObject);
  if (!source) return null;
  return source._id ? String(source._id) : null;
}

module.exports = {
  hasPresentValue,
  addIfPresent,
  unsetIfPresent,
  toPlainObject,
  commandIdFrom
};