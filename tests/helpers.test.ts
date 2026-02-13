import { describe, it, expect } from "vitest";
import {
  convertToSerializable,
  findInDict,
  parseJsonArray,
  parseJsonObject,
  parseBoolString,
} from "../src/common/helpers.js";

// ---------------------------------------------------------------------------
// convertToSerializable
// ---------------------------------------------------------------------------
describe("convertToSerializable", () => {
  it("converts Date objects to ISO strings", () => {
    const date = new Date("2024-01-15T10:30:00.000Z");
    expect(convertToSerializable(date)).toBe("2024-01-15T10:30:00.000Z");
  });

  it("converts bigint values to strings", () => {
    expect(convertToSerializable(BigInt(12345678901234))).toBe(
      "12345678901234"
    );
  });

  it("recursively converts nested objects containing Dates", () => {
    const input = {
      id: "abc-123",
      created: new Date("2024-06-01T00:00:00.000Z"),
      meta: { updated: new Date("2024-07-01T00:00:00.000Z") },
    };
    const result = convertToSerializable(input) as Record<string, unknown>;
    expect(result.id).toBe("abc-123");
    expect(result.created).toBe("2024-06-01T00:00:00.000Z");
    expect((result.meta as Record<string, unknown>).updated).toBe(
      "2024-07-01T00:00:00.000Z"
    );
  });

  it("converts Dates inside arrays", () => {
    const input = [new Date("2024-01-01T00:00:00.000Z"), "hello", 42];
    const result = convertToSerializable(input);
    expect(result).toEqual(["2024-01-01T00:00:00.000Z", "hello", 42]);
  });

  it("passes through primitives unchanged", () => {
    expect(convertToSerializable("hello")).toBe("hello");
    expect(convertToSerializable(42)).toBe(42);
    expect(convertToSerializable(null)).toBe(null);
    expect(convertToSerializable(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findInDict
// ---------------------------------------------------------------------------
describe("findInDict", () => {
  it("finds a top-level key", () => {
    expect(findInDict({ a: 1, b: 2 }, "b")).toBe(2);
  });

  it("finds a deeply nested key", () => {
    const data = { level1: { level2: { target: "found" } } };
    expect(findInDict(data, "target")).toBe("found");
  });

  it("finds a key inside a nested array of objects", () => {
    const data = { items: [{ id: 1 }, { id: 2, secret: "yes" }] };
    expect(findInDict(data, "secret")).toBe("yes");
  });

  it("returns undefined when key is absent", () => {
    expect(findInDict({ a: 1 }, "missing")).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(findInDict("string", "key")).toBeUndefined();
    expect(findInDict(null, "key")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseJsonArray
// ---------------------------------------------------------------------------
describe("parseJsonArray", () => {
  it("parses a JSON array string", () => {
    expect(parseJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("wraps a plain string in a single-element array", () => {
    expect(parseJsonArray("solo")).toEqual(["solo"]);
  });

  it("returns undefined for undefined input", () => {
    expect(parseJsonArray(undefined)).toBeUndefined();
  });

  it("returns the raw string wrapped if JSON parse fails", () => {
    expect(parseJsonArray("[invalid json")).toEqual(["[invalid json"]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonObject
// ---------------------------------------------------------------------------
describe("parseJsonObject", () => {
  it("parses a JSON object string", () => {
    expect(parseJsonObject('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns undefined for a non-object string", () => {
    expect(parseJsonObject("plain string")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseJsonObject(undefined)).toBeUndefined();
  });

  it("returns undefined for invalid JSON starting with {", () => {
    expect(parseJsonObject("{bad json")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseBoolString
// ---------------------------------------------------------------------------
describe("parseBoolString", () => {
  it('returns true for "true" (case-insensitive)', () => {
    expect(parseBoolString("true")).toBe(true);
    expect(parseBoolString("TRUE")).toBe(true);
    expect(parseBoolString("True")).toBe(true);
  });

  it('returns false for "false"', () => {
    expect(parseBoolString("false")).toBe(false);
  });

  it("returns undefined for undefined input", () => {
    expect(parseBoolString(undefined)).toBeUndefined();
  });
});
