/**
 * test-agent.js
 * 
 * Standalone verification script for ServerAutoCall's Autonomous AI Agent service (DeepSeek migration).
 * Verifies that agentService compiles, initializes correctly, and validates environments.
 */

const assert = require("assert");
const { runAgentOrchestrator } = require("./src/services/agentService");

async function runTests() {
  console.log("🚀 Starting DeepSeek Agent Service Verification Tests...\n");

  // Mock data setup
  const mockContacts = [
    { name: "Ali Al-Ghamdi", phoneNumber: "+966501111111" },
    { name: "Mohammed Al-Otaibi", phoneNumber: "+966502222222" }
  ];

  const mockDevices = [
    { deviceUid: "ab12c", deviceName: "Primary Phone", platform: "Android", online: true }
  ];

  // Test Case 1: Checking environment variable requirement
  console.log("Test Case 1: Verification of missing DEEPSEEK_API_KEY boundary...");
  try {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    
    await runAgentOrchestrator({
      prompt: "Call Ali",
      contacts: mockContacts,
      devices: mockDevices,
      currentTime: new Date().toISOString()
    });
    
    // If it did not throw, fail test
    assert.fail("Should have thrown an error when DEEPSEEK_API_KEY is missing");
  } catch (error) {
    assert.match(error.message, /DEEPSEEK_API_KEY environment variable is not defined/);
    console.log("✅ Passed: Throws error correctly if DeepSeek API key is missing.\n");
  }

  // Test Case 2: Verification of function loading
  console.log("Test Case 2: Service loads and exports correctly...");
  assert.strictEqual(typeof runAgentOrchestrator, "function");
  console.log("✅ Passed: Orchestrator entry point is a valid function.\n");

  console.log("🎉 All local mock tests completed successfully!");
}

runTests().catch(err => {
  console.error("❌ Test run failed:", err);
  process.exit(1);
});
