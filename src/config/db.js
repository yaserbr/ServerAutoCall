const mongoose = require("mongoose");
const { safeErrorMetadata } = require("../security/safeError");

async function connectToDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    console.warn("[MongoDB] MONGODB_URI is missing. Server will continue without DB connection.");
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected successfully to database: ${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (error) {
    console.error("[MongoDB] FATAL: Connection failed:", safeErrorMetadata(error));
    process.exit(1);
  }
}

module.exports = { connectToDatabase };
