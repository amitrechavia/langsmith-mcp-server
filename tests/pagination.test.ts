import { describe, it, expect } from "vitest";
import {
  paginateRuns,
  paginateMessages,
  buildPagesByCharBudget,
  truncateStrings,
} from "../src/common/pagination.js";

// ---------------------------------------------------------------------------
// truncateStrings
// ---------------------------------------------------------------------------
describe("truncateStrings", () => {
  it("truncates long strings and appends a suffix", () => {
    const result = truncateStrings("abcdefghij", 5);
    expect(result).toBe("abcde\u2026 (+5 chars)");
  });

  it("leaves short strings untouched", () => {
    expect(truncateStrings("hi", 10)).toBe("hi");
  });

  it("recursively truncates strings in objects and arrays", () => {
    const input = { name: "abcdefghij", items: ["1234567890"] };
    const result = truncateStrings(input, 4) as Record<string, unknown>;
    expect(result.name).toBe("abcd\u2026 (+6 chars)");
    expect((result.items as string[])[0]).toBe("1234\u2026 (+6 chars)");
  });

  it("returns input unchanged when previewChars is 0", () => {
    const input = { long: "a very long string" };
    expect(truncateStrings(input, 0)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// buildPagesByCharBudget
// ---------------------------------------------------------------------------
describe("buildPagesByCharBudget", () => {
  it("returns empty array for no runs", () => {
    expect(buildPagesByCharBudget([], 1000)).toEqual([]);
  });

  it("puts all runs on one page when they fit", () => {
    const runs = [{ id: "1" }, { id: "2" }];
    const pages = buildPagesByCharBudget(runs, 100_000);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it("splits runs across pages when they exceed the budget", () => {
    // Each run serializes to ~10 chars; set budget so only one fits per page
    const runs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pages = buildPagesByCharBudget(runs, 12);
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// paginateRuns
// ---------------------------------------------------------------------------
describe("paginateRuns", () => {
  const smallRuns: Record<string, unknown>[] = [
    { id: "r1", name: "run-1" },
    { id: "r2", name: "run-2" },
    { id: "r3", name: "run-3" },
  ];

  it("returns all runs on page 1 when budget is large", () => {
    const result = paginateRuns(smallRuns, 1, 100_000) as Record<
      string,
      unknown
    >;
    expect(result.page_number).toBe(1);
    expect(result.total_pages).toBe(1);
    expect(result.runs).toHaveLength(3);
  });

  it("returns empty runs for out-of-range page number", () => {
    const result = paginateRuns(smallRuns, 99, 100_000) as Record<
      string,
      unknown
    >;
    expect(result.runs).toHaveLength(0);
    expect(result.page_number).toBe(99);
  });

  it("returns empty runs for page 0 (out of range)", () => {
    const result = paginateRuns(smallRuns, 0, 100_000) as Record<
      string,
      unknown
    >;
    expect(result.runs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// paginateMessages
// ---------------------------------------------------------------------------
describe("paginateMessages", () => {
  const msgs: Record<string, unknown>[] = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ];

  it("uses 'result' key instead of 'runs'", () => {
    const result = paginateMessages(msgs, 1, 100_000) as Record<
      string,
      unknown
    >;
    expect(result.result).toHaveLength(2);
    expect(result).not.toHaveProperty("runs");
  });

  it("returns correct pagination metadata", () => {
    const result = paginateMessages(msgs, 1, 100_000) as Record<
      string,
      unknown
    >;
    expect(result.page_number).toBe(1);
    expect(result.total_pages).toBe(1);
    expect(result.max_chars_per_page).toBe(100_000);
  });
});
