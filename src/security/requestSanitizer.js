function sanitizeString(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\0/g, "");
}

function sanitizeValue(value, depth = 0) {
  if (depth > 8) return value;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = sanitizeValue(nestedValue, depth + 1);
    }
    return output;
  }

  return value;
}

function sanitizeRequestBody(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  next();
}

module.exports = {
  sanitizeRequestBody
};
