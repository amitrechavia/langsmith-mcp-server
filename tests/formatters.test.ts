import { describe, it, expect } from "vitest";
import {
  extractMessagesFromRun,
  formatMessages,
} from "../src/common/formatters.js";

// ---------------------------------------------------------------------------
// formatMessages
// ---------------------------------------------------------------------------
describe("formatMessages", () => {
  it("returns pretty-printed JSON", () => {
    const msgs = [{ role: "user", content: "hi" }];
    const result = formatMessages(msgs);
    expect(result).toBe(JSON.stringify(msgs, null, 2));
  });

  it("returns '[]' for an empty array", () => {
    expect(formatMessages([])).toBe("[]");
  });
});

// ---------------------------------------------------------------------------
// extractMessagesFromRun
// ---------------------------------------------------------------------------
describe("extractMessagesFromRun", () => {
  it("extracts messages from inputs.messages", () => {
    const run = {
      inputs: {
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "answer" },
        ],
      },
      outputs: null,
    };
    const msgs = extractMessagesFromRun(run);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("extracts messages from outputs.messages", () => {
    const run = {
      inputs: {},
      outputs: {
        messages: [{ role: "assistant", content: "response" }],
      },
    };
    const msgs = extractMessagesFromRun(run);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("response");
  });

  it("extracts OpenAI-style choices[].message from outputs", () => {
    const run = {
      inputs: {},
      outputs: {
        choices: [
          { message: { role: "assistant", content: "openai style" } },
        ],
      },
    };
    const msgs = extractMessagesFromRun(run);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("openai style");
  });

  it("deduplicates messages by id", () => {
    const run = {
      inputs: {
        messages: [{ id: "msg-1", role: "user", content: "hello" }],
      },
      outputs: {
        messages: [{ id: "msg-1", role: "user", content: "hello" }],
      },
    };
    const msgs = extractMessagesFromRun(run);
    expect(msgs).toHaveLength(1);
  });

  it("returns empty array when no messages found", () => {
    const run = { inputs: { data: "raw" }, outputs: { result: 42 } };
    expect(extractMessagesFromRun(run)).toEqual([]);
  });

  it("handles null inputs and outputs gracefully", () => {
    const run = { inputs: null, outputs: null } as unknown as Record<
      string,
      unknown
    >;
    expect(extractMessagesFromRun(run)).toEqual([]);
  });
});
