const mongoose = require("mongoose");

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
    console.error("[MongoDB] Connection failed:", error.message);
    return null;
  }
}

module.exports = { connectToDatabase };
