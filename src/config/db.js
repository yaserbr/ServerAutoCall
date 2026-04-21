const mongoose = require("mongoose");

async function connectToDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error("MONGODB_URI is missing in environment variables");
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
    throw error;
  }
}

module.exports = { connectToDatabase };
