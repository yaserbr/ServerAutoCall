function safeErrorMetadata(error) {
  if (!error || typeof error !== "object") {
    return { name: "Error" };
  }

  return {
    name: typeof error.name === "string" ? error.name : "Error",
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {})
  };
}

module.exports = { safeErrorMetadata };
