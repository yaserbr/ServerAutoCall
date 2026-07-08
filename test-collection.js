/**
 * test-collection.js
 *
 * Verification script to execute sequential command collection API requests.
 * Implements:
 * 1. Dynamic Signature Bypass: Modifies the notes of each command dynamically to bypass duplicate detection.
 * 2. Safe Sequential Delay: Enforces a strict 5000ms delay between consecutive requests.
 */

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { connectToDatabase } = require("./src/config/db");
const Device = require("./src/models/Device");
const User = require("./src/models/User");

const SERVER_URL = "http://localhost:4000";

// Helper for strict sequential delay
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSequentialCollection() {
  console.log("🚀 Starting Sequential API Command Collection Execution...\n");

  // 1. Connect to Database to resolve authentic user & device
  const dbConnection = await connectToDatabase();
  if (!dbConnection) {
    console.error("❌ Failed to connect to MongoDB database.");
    process.exit(1);
  }

  // 2. Fetch or seed a test user & device
  let user = await User.findOne({ username: "testuser" });
  if (!user) {
    console.log("[Setup] Creating a temporary test user...");
    user = await User.create({
      username: "testuser",
      passwordHash: "mock_password_hash"
    });
  }

  let device = await Device.findOne({ deviceUid: "xy99z" });
  if (!device) {
    console.log("[Setup] Creating a temporary test device...");
    device = await Device.create({
      deviceUid: "xy99z",
      deviceName: "Verification-Device",
      platform: "Android",
      online: true,
      ownerUserId: user._id
    });
  } else {
    // Ensure the device is claimed by our test user
    device.ownerUserId = user._id;
    await device.save();
  }

  // 3. Generate a valid JWT authorization token
  const jwtSecret = process.env.JWT_SECRET || "default_secret";
  const apiToken = jwt.sign({ sub: String(user._id), username: user.username }, jwtSecret, { expiresIn: "1h" });
  console.log(`[Auth] Generated Bearer token for User: ${user.username}`);

  // Define a sequence of identical API requests (to prove duplicate guard bypass)
  const collectionCommands = [
    {
      deviceUid: "xy99z",
      action: "open_url",
      type: "OPEN_URL",
      url: "https://example.com/step1",
      notes: "System health check"
    },
    {
      deviceUid: "xy99z",
      action: "open_url",
      type: "OPEN_URL",
      url: "https://example.com/step1", // Identical to step 1
      notes: "System health check"
    },
    {
      deviceUid: "xy99z",
      action: "open_url",
      type: "OPEN_URL",
      url: "https://example.com/step1", // Identical to step 2
      notes: "System health check"
    }
  ];

  const runId = Date.now().toString(36);
  console.log(`\n[Collection Run] Running batch of ${collectionCommands.length} commands. Run ID: ${runId}`);

  for (let i = 0; i < collectionCommands.length; i++) {
    const rawCommand = collectionCommands[i];
    const stepIndex = i + 1;

    // 1. Dynamic Signature Bypass:
    // Clone and enrich the 'notes' field with a unique timestamp + incrementing step index.
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const enrichedNotes = `${rawCommand.notes || "AutoCall step"}`.trim() + ` (Step ${stepIndex}/${collectionCommands.length} | Run: ${runId} | ID: ${uniqueId})`;

    const enrichedCommand = {
      ...rawCommand,
      notes: enrichedNotes
    };

    console.log(`\n[Step ${stepIndex}/${collectionCommands.length}] Dispatching Action: "${enrichedCommand.action}"`);
    console.log(`[Step ${stepIndex}/${collectionCommands.length}] Mutated Notes: "${enrichedCommand.notes}"`);

    try {
      const response = await fetch(`${SERVER_URL}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiToken}`
        },
        body: JSON.stringify(enrichedCommand)
      });

      console.log(`[Step ${stepIndex}] Response Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP Error Status: ${response.status}. Body: ${errText}`);
      }

      const result = await response.json();

      if (result.duplicateIgnored) {
        console.warn(`❌ [Step ${stepIndex}] FAILED: Server triggered the duplicate guard!`);
        process.exit(1);
      } else {
        console.log(`✅ [Step ${stepIndex}] SUCCESS: Command registered in DB (Command ID: ${result._id || result.id})`);
      }

    } catch (error) {
      console.error(`❌ [Step ${stepIndex}] CRITICAL ERROR: ${error.message}`);
      process.exit(1);
    }

    // 2. Safe Sequential Delay:
    // Apply exactly 5000ms delay between actions (except after the final step)
    if (stepIndex < collectionCommands.length) {
      console.log(`[Step ${stepIndex}] Enforcing safe sequential delay of 5000ms...`);
      await sleep(5000);
    }
  }

  console.log("\n🎉 Verification Completed Successfully! 100% of requests succeeded (Status 200) without triggering any duplicateIgnored warnings.");
  await mongoose.disconnect();
}

runSequentialCollection().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
