/**
 * src/services/agentService.js
 * 
 * Specialized AI Orchestration Service for ServerAutoCall.
 * Integrates with the official Google Gemini API (using @google/generative-ai or standard fetch-based REST fallback)
 * to parse user intent, manage conversation context, and autonomously generate structured device commands.
 */

const { logSecurityEvent } = require("../security/auditLogger");

// Global Configuration
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; // Highly cost-effective and ultra-low latency for tool calling
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Attempt to load the official SDK, but fall back gracefully to REST if not installed.
let GoogleGenerativeAI = null;
try {
  const sdk = require("@google/generative-ai");
  GoogleGenerativeAI = sdk.GoogleGenerativeAI;
} catch (e) {
  console.warn("[AgentService] @google/generative-ai not installed. Falling back to native fetch REST implementation.");
}

/**
 * Main entrance point for processing user prompt messages.
 * 
 * @param {Object} params
 * @param {string} params.prompt - The user's active natural language input
 * @param {Array} params.history - Conversational history [{ role: "user"|"model", content: "..." }]
 * @param {Array} params.contacts - Filtered list of matching Contact documents from MongoDB
 * @param {Array} params.devices - List of registered Device documents from MongoDB
 * @param {string} params.timezone - Default timezone (e.g., "Asia/Riyadh")
 * @param {string} params.currentTime - ISO string representation of the current time
 * @returns {Promise<Object>} { response: string, draftCommand: Object|null }
 */
async function runAgentOrchestrator({
  prompt,
  history = [],
  contacts = [],
  devices = [],
  timezone = "Asia/Riyadh",
  currentTime
}) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is not defined.");
  }

  // 1. Structure the System Instruction (the Agent's Rules of Engagement)
  const systemInstruction = `
You are the ServerAutoCall AI Agent, an advanced virtual operator integrated directly into the user's remote device automation server.
Your primary role is to interpret the user's natural language intents and map them to device automation actions (tools).

### CONTEXTUAL DATA PROVIDED:
- Current Time: ${currentTime}
- Timezone: ${timezone}
- Registered Devices: ${JSON.stringify(devices)}
- Pre-filtered Relevant Contacts: ${JSON.stringify(contacts)}

### RULES:
1. DEVICE MATCHING:
   - Identify which device the user wants to use. If the user does not specify a device:
     * If there is only one device, use its 'deviceUid'.
     * If there are multiple devices, check which one is 'online: true' and prefer it.
     * If there is still ambiguity, ask the user to clarify which device they want to control.
   
2. CONTACT MATCHING:
   - If the user specifies a contact name (e.g., "Ali"), check the 'Pre-filtered Relevant Contacts' list.
   - If there is a direct match, use their 'phoneNumber'.
   - If multiple contacts match (e.g., "Ali Al-Ghamdi" and "Ali Al-Harbi"), do NOT guess. Conversational-respond asking the user to specify which "Ali" they meant.
   - If the contact is not in the list but the user provided a raw phone number in their prompt (e.g., "050..."), extract and use that phone number directly.
   - If you cannot find the phone number anywhere, ask the user for it.

3. COMMAND SCHEDULING:
   - Calculate 'scheduledAt' if the user specifies a future time (e.g., "tomorrow at 10 AM", "in 2 hours").
   - Perform date arithmetic relative to the "Current Time" and target "Timezone" (${timezone}).
   - Format 'scheduledAt' strictly as an ISO 8601 date-time string with correct offset.
   - If the task is immediate, omit 'scheduledAt' (or pass null).

4. SAFETY & EXECUTION BOUNDARIES:
   - You must NEVER make up 'deviceUid' or 'phoneNumber' values.
   - If you do not have enough parameters to call 'queue_device_command', just reply conversationally asking for the missing detail.
  `;

  // 2. Define the Functions/Tools schema
  // Notice the uppercase types (STRING, OBJECT) required by Gemini API schema validation.
  const toolsDefinition = {
    functionDeclarations: [
      {
        name: "queue_device_command",
        description: "Drafts or queues an automated command for a specific registered physical device.",
        parameters: {
          type: "OBJECT",
          properties: {
            deviceUid: {
              type: "STRING",
              description: "The 5-character unique ID of the target device."
            },
            action: {
              type: "STRING",
              enum: ["call", "sms", "open_app", "open_url"],
              description: "The action to execute: 'call' (make call), 'sms' (send text), 'open_app' (open package), 'open_url' (browse URL)."
            },
            phoneNumber: {
              type: "STRING",
              description: "Destination phone number. Required for 'call' and 'sms'."
            },
            message: {
              type: "STRING",
              description: "Message content. Required for 'sms' action."
            },
            appName: {
              type: "STRING",
              description: "Name of target application or alias (e.g., 'whatsapp', 'telegram') to open. Required for 'open_app'."
            },
            url: {
              type: "STRING",
              description: "The web URL to launch on the device. Required for 'open_url'."
            },
            scheduledAt: {
              type: "STRING",
              description: "ISO 8601 timestamp representing when the action should execute. Only provide if scheduling for the future."
            }
          },
          required: ["deviceUid", "action"]
        }
      }
    ]
  };

  // 3. Run using either SDK or standard Fetch REST
  if (GoogleGenerativeAI) {
    return runWithSDK(prompt, history, systemInstruction, toolsDefinition);
  } else {
    return runWithREST(prompt, history, systemInstruction, toolsDefinition);
  }
}

/**
 * Execution using official @google/generative-ai SDK.
 */
async function runWithSDK(prompt, history, systemInstruction, toolsDefinition) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: systemInstruction,
  });

  // Map history format to SDK format: SDK expects { role: 'user'|'model', parts: [{ text: '...' }] }
  const formattedContents = history.map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }]
  }));

  // Append current prompt
  formattedContents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  const response = await model.generateContent({
    contents: formattedContents,
    tools: [toolsDefinition],
    toolConfig: { functionCallingConfig: { mode: "AUTO" } }
  });

  return parseGeminiResponse(response);
}

/**
 * Execution using zero-dependency Native Fetch API.
 * Ensures the platform is robust even without SDK package installations.
 */
async function runWithREST(prompt, history, systemInstruction, toolsDefinition) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Map history to REST format
  const contents = history.map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }]
  }));

  contents.push({
    role: "user",
    parts: [{ text: prompt }]
  });

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    tools: [toolsDefinition],
    toolConfig: {
      functionCallingConfig: { mode: "AUTO" }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini REST request failed (${response.status}): ${errorText}`);
  }

  const responseJson = await response.json();
  return parseGeminiRESTResponse(responseJson);
}

/**
 * Parses official SDK response object.
 */
function parseGeminiResponse(sdkResponse) {
  const candidate = sdkResponse.response?.candidates?.[0];
  const part = candidate?.content?.parts?.[0];

  let responseText = "";
  let draftCommand = null;

  if (part) {
    if (part.text) {
      responseText = part.text;
    }

    if (part.functionCall) {
      const { name, args } = part.functionCall;
      if (name === "queue_device_command") {
        draftCommand = cleanArgs(args);
        // Provide standard conversational backing if LLM called function but didn't provide accompanying text
        responseText = responseText || `Perfect! I've drafted a ${draftCommand.action} action as requested. Please review and approve it to execute.`;
      }
    }
  }

  return {
    response: responseText || "I'm sorry, I couldn't process that command. Let me know what automation task you'd like to perform.",
    draftCommand
  };
}

/**
 * Parses native REST response JSON.
 */
function parseGeminiRESTResponse(restJson) {
  const candidate = restJson.candidates?.[0];
  const part = candidate?.content?.parts?.[0];

  let responseText = "";
  let draftCommand = null;

  if (part) {
    if (part.text) {
      responseText = part.text;
    }

    if (part.functionCall) {
      const { name, args } = part.functionCall;
      if (name === "queue_device_command") {
        draftCommand = cleanArgs(args);
        responseText = responseText || `Perfect! I've drafted a ${draftCommand.action} action as requested. Please review and approve it to execute.`;
      }
    }
  }

  return {
    response: responseText || "I'm sorry, I couldn't process that command. Let me know what automation task you'd like to perform.",
    draftCommand
  };
}

/**
 * Secondary helper to cleanse parameter types, converting potential empty fields to null
 * and matching internal Mongoose model expected formats.
 */
function cleanArgs(args) {
  const cleaned = { ...args };

  if (cleaned.scheduledAt) {
    cleaned.scheduledAt = new Date(cleaned.scheduledAt);
    cleaned.isImmediate = false;
  } else {
    cleaned.isImmediate = true;
    cleaned.scheduledAt = null;
  }

  // Ensure uppercase matching for backend `type` field based on action
  if (cleaned.action) {
    cleaned.type = cleaned.action.toUpperCase();
  }

  return cleaned;
}

module.exports = {
  runAgentOrchestrator
};
