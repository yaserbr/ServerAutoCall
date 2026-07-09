/**
 * src/services/agentService.js
 * 
 * Specialized AI Orchestration Service for ServerAutoCall.
 * Integrates directly with DeepSeek API (using native fetch-based REST)
 * to parse user intent, manage conversation context, and autonomously generate structured device commands
 * supporting ALL 13 system capabilities of the automation platform.
 */


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
 * @param {string} params.activeDeviceUid - Optional currently selected active device UID from client
 * @returns {Promise<Object>} { response: string, draftCommand: Object|null }
 */
async function runAgentOrchestrator({
  prompt,
  history = [],
  contacts = [],
  devices = [],
  timezone = "Asia/Riyadh",
  currentTime,
  activeDeviceUid
}) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY environment variable is not defined.");
  }

  // 1. Structure the System Instruction (the Agent's Rules of Engagement)
  // Hardened with forceful instructions to use tools instead of conversational text.
  const systemInstruction = `
You are the ServerAutoCall AI Agent, an advanced virtual operator integrated directly into the user's remote device automation server.
Your primary role is to interpret the user's natural language intents and map them to device automation actions by CALLING THE 'queue_device_command' TOOL.

### MANDATORY TOOL CALLING DIRECTIVE:
You MUST ALWAYS invoke the 'queue_device_command' tool if the user's request matches any of our supported actions. Under no circumstances should you reply conversationally saying you have executed, started, or drafted an action in text without calling the tool. Do NOT answer conversationally when you can execute a tool.

### CONTEXTUAL DATA PROVIDED:
- Current Time: ${currentTime}
- Timezone: ${timezone}
- Registered Devices: ${JSON.stringify(devices)}
- Pre-filtered Relevant Contacts: ${JSON.stringify(contacts)}
- Active Selected Device UID: ${activeDeviceUid || "None"}

### CONVERSATIONAL INTENT MAPPING RULES:
- If the user says "return", "go back", "return to autocall", or "close app", you MUST call 'queue_device_command' with action 'return_to_autocall'.
- If the user says "turn on auto answer", "enable auto-answer", or "auto answer in 23 seconds", you MUST call 'queue_device_command' with action 'auto_answer' and 'enabled' as true.
- If the user says "turn off auto answer" or "disable auto-answer", you MUST call 'queue_device_command' with action 'auto_answer' and 'enabled' as false.
- If the user says "stop sharing", "stop mirror", or "end screen sharing", you MUST call 'queue_device_command' with action 'stop_screen_mirror'.
- If the user says "mirror", "start mirror", or "share screen", you MUST call 'queue_device_command' with action 'start_screen_mirror'.
- If the user asks to run, trigger, or execute a saved collection or template by name (e.g., "Execute the 'Morning Routine' collection" or "Run my test collection"), you MUST call the 'execute_device_collection' tool with 'collectionName' and the target 'deviceUid'.

### RULES:
1. DEVICE MATCHING:
   - You MUST target the Active Selected Device UID ('${activeDeviceUid || ""}') as the target 'deviceUid' for your tool call, unless the user explicitly names a different registered device.
   - If no active selected device is specified, and the user did not specify a device:
     * If there is only one device, use its 'deviceUid'.
     * If there are multiple devices, check which one is 'online: true' and prefer it.

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

6. STATELESS REAL-TIME EXECUTION:
   - You must treat every user prompt as a stateless, immediate real-time request. Never assume an action is 'already done' or 'already queued' based on the conversation history. If the user says 'close', 'return', 'close webview', or any other command, you MUST call the 'queue_device_command' tool immediately, even if you just called it in the previous turn. Duplicate commands are expected and must be executed every single time.

7. SAFETY & EXECUTION BOUNDARIES:
   - You must NEVER make up 'deviceUid' or 'phoneNumber' values.
   - If you do not have enough parameters to call 'queue_device_command', just reply conversationally asking for the missing detail.
  `;

  // 2. Define the DeepSeek standard OpenAI-compatible tool schema with highly detailed property descriptions
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
              description: "The automation action to execute. Must be one of:\n" +
                           "- 'call' (make an outbound call)\n" +
                           "- 'end' (hang up current call)\n" +
                           "- 'sms' (send outbound text)\n" +
                           "- 'auto_answer' (configure auto answer enablement/hangup settings)\n" +
                           "- 'webview' or 'open_url' (open URL in browser overlay)\n" +
                           "- 'close_webview' (close the active URL overlay)\n" +
                           "- 'open_app' (open a specific app package)\n" +
                           "- 'return_to_autocall' (return foreground focus to AutoCall app)\n" +
                           "- 'download_data' (network stress download test)\n" +
                           "- 'start_screen_mirror' (start screen sharing)\n" +
                           "- 'stop_screen_mirror' (end screen sharing)\n" +
                           "- 'screen_touch' (simulate screen coordinate tap)\n" +
                           "- 'screen_swipe' (simulate screen coordinate swipe gesture)"
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
    },
    {
      type: "function",
      function: {
        name: "execute_device_collection",
        description: "Executes a saved command collection (or template) by name on a target device.",
        parameters: {
          type: "object",
          properties: {
            deviceUid: {
              type: "string",
              description: "The 5-character unique ID of the target device."
            },
            collectionName: {
              type: "string",
              description: "The name of the saved collection/template to execute."
            }
          },
          required: ["deviceUid", "collectionName"]
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
  return parseDeepSeekResponse(responseJson, prompt, activeDeviceUid);
}

/**
 * Parses official DeepSeek response object.
 */
function parseDeepSeekResponse(resultJson, prompt, activeDeviceUid) {
  const choiceMessage = resultJson.choices?.[0]?.message;
  let responseText = choiceMessage?.content || "";
  let draftCommand = null;

  if (choiceMessage?.tool_calls?.[0]) {
    const toolCall = choiceMessage.tool_calls[0];
    if (toolCall.function?.name === "execute_device_collection") {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        draftCommand = {
          action: "execute_collection",
          type: "EXECUTE_COLLECTION",
          collectionName: args.collectionName,
          deviceUid: args.deviceUid || activeDeviceUid,
          isImmediate: true
        };
        responseText = responseText || `Perfect! I've triggered the collection '${args.collectionName}' for execution.`;
      } catch (err) {
        console.error("[DeepSeek] Tool call arguments parse error for execute_device_collection:", err);
      }
    } else if (toolCall.function?.name === "queue_device_command") {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        draftCommand = cleanArgs(args, prompt);
        responseText = responseText || `Perfect! I've executed a ${draftCommand.action} action as requested.`;
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
function cleanArgs(args, prompt = "") {
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

  // 3. Fallback parameter mapping for auto_answer configs
  if (cleaned.action === "auto_answer") {
    // If the model parsed delay/seconds into durationSeconds, map it to autoHangupSeconds
    if (cleaned.autoHangupSeconds === undefined && cleaned.durationSeconds !== undefined) {
      cleaned.autoHangupSeconds = cleaned.durationSeconds;
      delete cleaned.durationSeconds;
    }
    // Defensive smart default for enabled if missing
    if (cleaned.enabled === undefined) {
      const lowerPrompt = String(prompt).toLowerCase();
      if (lowerPrompt.includes("off") || lowerPrompt.includes("disable") || lowerPrompt.includes("stop") || lowerPrompt.includes("turn off")) {
        cleaned.enabled = false;
      } else {
        cleaned.enabled = true;
      }
    }
  }

  // 4. Normalize schedules
  if (cleaned.scheduledAt) {
    cleaned.scheduledAt = new Date(cleaned.scheduledAt);
    cleaned.isImmediate = false;
  } else {
    cleaned.isImmediate = true;
    cleaned.scheduledAt = null;
  }

  // 5. Align command types
  if (cleaned.action) {
    cleaned.type = cleaned.action.toUpperCase();
  }

  return cleaned;
}

module.exports = {
  runAgentOrchestrator
};
