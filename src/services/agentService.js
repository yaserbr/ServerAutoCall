/**
 * src/services/agentService.js
 * 
 * Specialized AI Orchestration Service for ServerAutoCall.
 * Integrates directly with DeepSeek API (using native fetch-based REST)
 * to parse user intent, manage conversation context, and autonomously generate structured device commands
 * supporting ALL 13 system capabilities of the automation platform.
 */

const { logSecurityEvent } = require("../security/auditLogger");

// DeepSeek Global Configuration
const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"; // Highly recommended V4 standard model

/**
 * Main entrance point for processing user prompt messages using DeepSeek.
 * Supports all 13 automation actions available on the ServerAutoCall platform.
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
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY environment variable is not defined.");
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

### SUPPORTED AUTOMATION ACTIONS:
- 'call': Make an outbound phone call.
- 'end': Hang up or end the current ongoing phone call.
- 'sms': Send an outbound text message (SMS).
- 'auto_answer': Enable, disable, or adjust auto-answer configuration.
- 'webview' (or 'open_url'): Launch a web URL on the device's browser/webview overlay. Requires a 'url' parameter.
- 'close_webview': Close the active URL browser/webview overlay on the device.
- 'open_app': Open a specified mobile app (e.g., WhatsApp, YouTube, Maps) using package name.
- 'return_to_autocall': Return the device's UI back to the foreground host AutoCall app.
- 'download_data': Trigger a network stress/download data speed test in MB. Requires 'size' or 'amount' (in MB).
- 'start_screen_mirror': Start broadcasting live screen sharing mirror from the device.
- 'stop_screen_mirror': Stop active live screen sharing broadcast.
- 'screen_touch': Emulate a single-coordinate touch tap on the physical screen.
- 'screen_swipe': Emulate a touch drag swipe gesture on the physical screen.

### RULES:
1. DEVICE MATCHING:
   - Identify which device the user wants to use. If the user does not specify a device:
     * If there is only one device, use its 'deviceUid'.
     * If there are multiple devices, check which one is 'online: true' and prefer it.
     * If there is still ambiguity, ask the user to clarify which device they want to control.
   
2. CONTACT MATCHING:
   - If the user specifies a contact name (e.g., "Ali"), check the 'Pre-filtered Relevant Contacts' list.
   - If there is a direct match, use their 'phoneNumber'.
   - If multiple contacts match (e.g., "Ali Al-Ghamdi" and "Ali Al-Harbi"), do NOT guess. Ask the user to specify which "Ali" they meant.
   - If the contact is not in the list but the user provided a raw phone number in their prompt, extract and use that phone number directly.
   - If you cannot find the phone number anywhere, ask the user for it.

3. COMMAND SCHEDULING:
   - Calculate 'scheduledAt' if the user specifies a future time (e.g., "tomorrow at 10 AM", "in 2 hours").
   - Perform date arithmetic relative to the "Current Time" and target "Timezone" (${timezone}).
   - Format 'scheduledAt' strictly as an ISO 8601 date-time string with correct offset.
   - If the task is immediate, omit 'scheduledAt' (or pass null).

4. PARAMETER MAPPING:
   - For webview requests, map the target address to the 'url' parameter and use action 'webview'.
   - For download requests, map the requested size/amount in MB to the 'size' or 'amount' parameter and use action 'download_data'.

5. SMART URL DETECTION:
   - If the user prompt consists solely of a URL, or clearly contains a URL without any other action requested, you MUST automatically infer the user wants to use the 'open_url' action and pass the URL accordingly.

6. SAFETY & EXECUTION BOUNDARIES:
   - You must NEVER make up 'deviceUid' or 'phoneNumber' values.
   - If you do not have enough parameters to call 'queue_device_command', just reply conversationally asking for the missing detail.
  `;

  // 2. Define the DeepSeek standard OpenAI-compatible tool schema with ALL properties
  const toolsDefinition = [
    {
      type: "function",
      function: {
        name: "queue_device_command",
        description: "Drafts or queues an automated command for a specific registered physical device.",
        parameters: {
          type: "object",
          properties: {
            deviceUid: {
              type: "string",
              description: "The 5-character unique ID of the target device."
            },
            action: {
              type: "string",
              enum: [
                "call",
                "end",
                "sms",
                "auto_answer",
                "webview",
                "open_url",
                "close_webview",
                "open_app",
                "return_to_autocall",
                "download_data",
                "start_screen_mirror",
                "stop_screen_mirror",
                "screen_touch",
                "screen_swipe"
              ],
              description: "The action to execute."
            },
            phoneNumber: {
              type: "string",
              description: "Destination phone number. Required for 'call' and 'sms'."
            },
            message: {
              type: "string",
              description: "Message content. Required for 'sms' action."
            },
            durationSeconds: {
              type: "number",
              description: "Call duration in seconds before auto-hangup. Optional for 'call'."
            },
            autoHangupSeconds: {
              type: "number",
              description: "Auto hangup delay threshold in seconds. Optional for 'call' and 'auto_answer'."
            },
            enabled: {
              type: "boolean",
              description: "Enables (true) or disables (false) auto-answer configurations. Required for 'auto_answer'."
            },
            appName: {
              type: "string",
              description: "Name of target application (e.g., 'WhatsApp', 'Chrome') to open. Required for 'open_app'."
            },
            resolvedPackageName: {
              type: "string",
              description: "Android package identifier (e.g. 'com.whatsapp'). Optional for 'open_app'."
            },
            url: {
              type: "string",
              description: "The web URL to launch. Required for 'webview' or 'open_url'."
            },
            size: {
              type: "number",
              description: "Total size of stress test network download in Megabytes (MB). Used for 'download_data' action."
            },
            amount: {
              type: "number",
              description: "Total amount of stress test network download in Megabytes (MB). Alternative for 'download_data' action."
            },
            downloadSizeMb: {
              type: "number",
              description: "Alternative parameter specifying total download size in Megabytes (MB). Used for 'download_data' action."
            },
            notes: {
              type: "string",
              description: "Optional custom notes or comments to append to this command."
            },
            scheduledAt: {
              type: "string",
              description: "ISO 8601 timestamp representing when the action should execute. Only provide if scheduling for the future."
            },
            x: {
              type: "number",
              description: "Touch X pixel coordinate. Required for 'screen_touch'."
            },
            y: {
              type: "number",
              description: "Touch Y pixel coordinate. Required for 'screen_touch'."
            },
            screenWidth: {
              type: "number",
              description: "Host screen width reference in pixels. Required for 'screen_touch' / 'screen_swipe'."
            },
            screenHeight: {
              type: "number",
              description: "Host screen height reference in pixels. Required for 'screen_touch' / 'screen_swipe'."
            },
            startX: {
              type: "number",
              description: "Touch drag swipe start horizontal X pixel coordinate. Required for 'screen_swipe'."
            },
            startY: {
              type: "number",
              description: "Touch drag swipe start vertical Y pixel coordinate. Required for 'screen_swipe'."
            },
            endX: {
              type: "number",
              description: "Touch drag swipe end horizontal X pixel coordinate. Required for 'screen_swipe'."
            },
            endY: {
              type: "number",
              description: "Touch drag swipe end vertical Y pixel coordinate. Required for 'screen_swipe'."
            },
            durationMs: {
              type: "number",
              description: "Total duration of swipe drag gesture in milliseconds. Required for 'screen_swipe'."
            }
          },
          required: ["deviceUid", "action"]
        }
      }
    }
  ];

  // 3. Format history for DeepSeek (standard messages array)
  const messages = [
    { role: "system", content: systemInstruction }
  ];

  history.forEach(h => {
    const role = h.role === "model" || h.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: h.content });
  });

  // Append current prompt
  messages.push({ role: "user", content: prompt });

  // 4. Dispatch REST Call to DeepSeek API
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      tools: toolsDefinition,
      tool_choice: "auto"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API request failed (${response.status}): ${errorText}`);
  }

  const responseJson = await response.json();
  return parseDeepSeekResponse(responseJson);
}

/**
 * Parses official DeepSeek response object.
 */
function parseDeepSeekResponse(resultJson) {
  const choiceMessage = resultJson.choices?.[0]?.message;
  let responseText = choiceMessage?.content || "";
  let draftCommand = null;

  if (choiceMessage?.tool_calls?.[0]) {
    const toolCall = choiceMessage.tool_calls[0];
    if (toolCall.function?.name === "queue_device_command") {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        draftCommand = cleanArgs(args);
        responseText = responseText || `Perfect! I've drafted a ${draftCommand.action} action as requested.`;
      } catch (err) {
        console.error("[DeepSeek] Tool call arguments parse error:", err);
      }
    }
  }

  return {
    response: responseText || "I'm sorry, I couldn't process that command. Let me know what task you'd like to perform.",
    draftCommand
  };
}

/**
 * Post-processes arguments generated by DeepSeek to match expected Mongoose validation formats.
 * Transparently translates requested 'webview' and 'download_data' parameters.
 */
function cleanArgs(args) {
  const cleaned = { ...args };

  // 1. Map 'webview' action to internal Mongoose expected 'open_url'
  if (cleaned.action === "webview") {
    cleaned.action = "open_url";
  }

  // 2. Map AI 'size' or 'amount' to Mongoose schema standard 'downloadSizeMb'
  if (cleaned.action === "download_data") {
    if (cleaned.size !== undefined) {
      cleaned.downloadSizeMb = cleaned.size;
      delete cleaned.size;
    } else if (cleaned.amount !== undefined) {
      cleaned.downloadSizeMb = cleaned.amount;
      delete cleaned.amount;
    }
  }

  // 3. Normalize schedules
  if (cleaned.scheduledAt) {
    cleaned.scheduledAt = new Date(cleaned.scheduledAt);
    cleaned.isImmediate = false;
  } else {
    cleaned.isImmediate = true;
    cleaned.scheduledAt = null;
  }

  // 4. Align command types
  if (cleaned.action) {
    cleaned.type = cleaned.action.toUpperCase();
  }

  return cleaned;
}

module.exports = {
  runAgentOrchestrator
};
