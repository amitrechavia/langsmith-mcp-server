/**
 * Output formatting utilities for messages and run.
 */

/**
 * Format messages as pretty-printed JSON.
 *
 * @param messages - List of message objects
 * @returns JSON string (indent=2) representation of messages
 */
export function formatMessages(
  messages: Record<string, unknown>[]
): string {
  return JSON.stringify(messages, null, 2);
}

/**
 * Recursively extract messages from nested dictionary structures.
 *
 * @param data - Dictionary, list, or other data structure to search
 * @param _path - Current path in the structure (for debugging)
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum recursion depth to avoid infinite loops
 * @returns List of message dictionaries found
 */
function extractMessagesFromDict(
  data: unknown,
  _path: string = "",
  depth: number = 0,
  maxDepth: number = 5
): Record<string, unknown>[] {
  if (depth > maxDepth) {
    return [];
  }

  const messages: Record<string, unknown>[] = [];

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;

    // Check for messages key directly (highest priority)
    if ("messages" in obj) {
      const msgs = obj.messages;
      if (Array.isArray(msgs)) {
        for (const msg of msgs) {
          if (typeof msg === "object" && msg !== null && !Array.isArray(msg)) {
            messages.push(msg as Record<string, unknown>);
          }
        }
        return messages; // Return early since we found messages
      }
    }

    // Check for single message key
    if ("message" in obj) {
      const msg = obj.message;
      if (typeof msg === "object" && msg !== null && !Array.isArray(msg)) {
        messages.push(msg as Record<string, unknown>);
      }
    }

    // Check for OpenAI-style choices
    if ("choices" in obj) {
      const choices = obj.choices;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          if (
            typeof choice === "object" &&
            choice !== null &&
            !Array.isArray(choice)
          ) {
            const choiceObj = choice as Record<string, unknown>;
            if ("message" in choiceObj) {
              const msg = choiceObj.message;
              if (
                typeof msg === "object" &&
                msg !== null &&
                !Array.isArray(msg)
              ) {
                messages.push(msg as Record<string, unknown>);
              }
            }
          }
        }
      }
    }

    // If we found messages at this level, return them (don't recurse)
    if (messages.length > 0) {
      return messages;
    }

    // Recursively search nested dictionaries
    for (const [key, value] of Object.entries(obj)) {
      if (
        typeof value === "object" &&
        value !== null
      ) {
        const nestedMsgs = extractMessagesFromDict(
          value,
          `${_path}.${key}`,
          depth + 1,
          maxDepth
        );
        messages.push(...nestedMsgs);
      }
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "object" && item !== null) {
        const nestedMsgs = extractMessagesFromDict(
          item,
          `${_path}[]`,
          depth + 1,
          maxDepth
        );
        messages.push(...nestedMsgs);
      }
    }
  }

  return messages;
}

/**
 * Extract messages from a run dictionary.
 *
 * Messages can be in various locations:
 * - run.inputs.messages (for LLM runs)
 * - run.outputs.messages (for some run types)
 * - run.outputs.output.messages (for nested output structures)
 * - run.outputs.choices[0].message (for OpenAI-style outputs)
 *
 * @param runDict - Run dictionary from LangSmith
 * @returns List of message dictionaries
 */
export function extractMessagesFromRun(
  runDict: Record<string, unknown>
): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  // Check inputs for messages
  const inputs = runDict.inputs;
  if (inputs !== undefined && inputs !== null) {
    const inputMessages = extractMessagesFromDict(inputs, "inputs");
    messages.push(...inputMessages);
  }

  // Check outputs for messages (including nested structures)
  const outputs = runDict.outputs;
  if (outputs !== undefined && outputs !== null) {
    const outputMessages = extractMessagesFromDict(outputs, "outputs");
    messages.push(...outputMessages);
  }

  // Filter to ensure we only return message dictionaries
  // Deduplicate messages by ID if present
  const validMessages: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
      continue;
    }
    const msgId = msg.id;
    if (typeof msgId === "string") {
      if (seenIds.has(msgId)) {
        continue;
      }
      seenIds.add(msgId);
    }
    validMessages.push(msg);
  }

  return validMessages;
}

/**
 * Extract messages from runs and return pretty-printed JSON in "formatted".
 */
export function formatRunsWithMessages(
  runs: Record<string, unknown>[]
): Record<string, unknown> {
  const allMessages: Record<string, unknown>[] = [];
  for (const run of runs) {
    const runMessages = extractMessagesFromRun(run);
    if (runMessages.length > 0) {
      allMessages.push(...runMessages);
    }
  }
  return { formatted: formatMessages(allMessages) };
}
