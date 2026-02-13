/**
 * Helper functions for the LangSmith MCP server.
 */

import { Client } from "langsmith";

/**
 * Create a LangSmith client from environment variables.
 *
 * Reads LANGSMITH_API_KEY (required), LANGSMITH_ENDPOINT (optional),
 * and LANGSMITH_WORKSPACE_ID (optional) from the environment.
 *
 * @returns LangSmith Client instance
 * @throws Error if LANGSMITH_API_KEY is not set
 */
export function getLangSmithClient(): Client {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "API key not found. Set LANGSMITH_API_KEY environment variable."
    );
  }
  return new Client({
    apiKey,
    apiUrl: process.env.LANGSMITH_ENDPOINT || undefined,
    workspaceId: process.env.LANGSMITH_WORKSPACE_ID || undefined,
  });
}

/**
 * Get API key and endpoint from environment variables.
 * Used by tools that call LangSmith REST APIs directly (e.g. billing/usage).
 *
 * @returns Tuple of [apiKey, endpoint]. Endpoint is normalized (no trailing slash).
 * @throws Error if LANGSMITH_API_KEY is not set
 */
export function getApiKeyAndEndpoint(): [string, string] {
  const apiKey = process.env.LANGSMITH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "API key not found. Set LANGSMITH_API_KEY environment variable."
    );
  }
  const endpoint = (
    process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com"
  ).replace(/\/+$/, "");
  return [apiKey, endpoint];
}

/**
 * Extract a LangGraph app host name from run stats.
 *
 * @param runStats - The run stats object
 * @returns The LangGraph app host name, or undefined if not found
 */
export function getLanggraphAppHostName(
  runStats: Record<string, unknown>
): string | undefined {
  if (!runStats || !runStats.run_facets) return undefined;

  const runFacets = runStats.run_facets;
  if (!Array.isArray(runFacets)) return undefined;

  for (const runFacet of runFacets) {
    if (typeof runFacet !== "object" || runFacet === null) continue;
    try {
      for (const rfk of Object.keys(runFacet as Record<string, unknown>)) {
        const match = rfk.match(/https?:\/\/(?<langgraphHost>[^/]+)/);
        if (match?.groups?.langgraphHost) {
          return match.groups.langgraphHost;
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Parse the as_of parameter, converting ISO timestamps to Date objects
 * while leaving version tags as strings.
 *
 * @param asOf - Dataset version tag OR ISO timestamp string
 * @returns Date object if asOf is a valid ISO timestamp, otherwise the original string
 */
export function parseAsOfParameter(asOf: string): Date | string {
  try {
    const date = new Date(asOf);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch {
    // Not a valid date, return as string (version tag)
  }
  return asOf;
}

/**
 * Recursively search for a key in a nested dictionary or list.
 * Returns the first occurrence found during depth-first traversal.
 *
 * @param data - The data structure to search in
 * @param key - The key to search for
 * @returns The value associated with the key if found, otherwise undefined
 */
export function findInDict(
  data: unknown,
  key: string
): unknown | undefined {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (key in obj) {
      return obj[key];
    }
    for (const value of Object.values(obj)) {
      const result = findInDict(value, key);
      if (result !== undefined) {
        return result;
      }
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      const result = findInDict(item, key);
      if (result !== undefined) {
        return result;
      }
    }
  }
  return undefined;
}

/**
 * Recursively convert Date objects to ISO strings in data structures.
 * Note: In the JS SDK, UUIDs are already strings, unlike the Python SDK
 * where they are uuid.UUID objects. This function primarily handles Dates.
 */
export function convertToSerializable(obj: unknown): unknown {
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(convertToSerializable);
  }
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertToSerializable(value);
    }
    return result;
  }
  return obj;
}

/**
 * Recursively count the total number of characters in a data structure.
 */
export function countCharacters(obj: unknown): number {
  if (typeof obj === "string") {
    return obj.length;
  }
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    let count = 0;
    for (const value of Object.values(obj)) {
      count += countCharacters(value);
    }
    return count;
  }
  if (Array.isArray(obj)) {
    let count = 0;
    for (const item of obj) {
      count += countCharacters(item);
    }
    return count;
  }
  // For other types, convert to string and count
  return String(obj).length;
}

/**
 * Recursively count the total number of fields/keys in a data structure.
 */
export function countFields(obj: unknown): number {
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    let count = Object.keys(obj).length;
    for (const value of Object.values(obj)) {
      count += countFields(value);
    }
    return count;
  }
  if (Array.isArray(obj)) {
    let count = 0;
    for (const item of obj) {
      count += countFields(item);
    }
    return count;
  }
  return 0;
}

/**
 * Filter a run dictionary to only include selected fields.
 * If select is undefined or empty, returns the full dictionary.
 */
export function filterFields(
  runDict: Record<string, unknown>,
  select?: string[]
): Record<string, unknown> {
  if (!select || select.length === 0) {
    return runDict;
  }
  const filtered: Record<string, unknown> = {};
  for (const field of select) {
    if (field in runDict) {
      filtered[field] = runDict[field];
    }
  }
  return filtered;
}

/**
 * Build a simplified trace tree structure showing top-level fields
 * with metrics for nested content.
 *
 * @param runDict - The dictionary to build a tree from
 * @param depth - How many levels deep to show actual content before summarizing.
 *               0 = summarize all nested structures (default)
 */
export function buildTraceTree(
  runDict: Record<string, unknown>,
  depth: number = 0
): Record<string, unknown> {
  const tree: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(runDict)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const dictValue = value as Record<string, unknown>;
      const keys = Object.keys(dictValue);
      if (keys.length === 0) {
        tree[key] = {};
      } else if (depth > 0) {
        tree[key] = buildTraceTree(dictValue, depth - 1);
      } else {
        const fieldCount = countFields(dictValue);
        if (fieldCount === 0) {
          tree[key] = {};
        } else {
          tree[key] = {
            _type: "dict",
            _field_count: fieldCount,
            _character_count: countCharacters(dictValue),
            _keys: keys.slice(0, 10),
          };
        }
      }
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        tree[key] = [];
      } else if (depth > 0) {
        const processedItems: unknown[] = [];
        for (const item of value) {
          if (
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item)
          ) {
            processedItems.push(
              buildTraceTree(item as Record<string, unknown>, depth - 1)
            );
          } else if (Array.isArray(item)) {
            processedItems.push(
              item.map((subitem) =>
                typeof subitem === "object" &&
                subitem !== null &&
                !Array.isArray(subitem)
                  ? buildTraceTree(
                      subitem as Record<string, unknown>,
                      depth - 1
                    )
                  : subitem
              )
            );
          } else {
            processedItems.push(item);
          }
        }
        tree[key] = processedItems;
      } else {
        const preview: unknown[] = [];
        for (const item of value.slice(0, 2)) {
          if (
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item)
          ) {
            preview.push({
              _type: "dict",
              _keys: Object.keys(item as Record<string, unknown>).slice(0, 5),
            });
          } else if (Array.isArray(item)) {
            preview.push({ _type: "list", _length: item.length });
          } else {
            const strVal = String(item);
            preview.push(strVal.length > 100 ? strVal.slice(0, 100) : strVal);
          }
        }
        tree[key] = {
          _type: "list",
          _length: value.length,
          _field_count: countFields(value),
          _character_count: countCharacters(value),
          _preview: preview,
        };
      }
    } else {
      tree[key] = value;
    }
  }

  return tree;
}

/**
 * Parse a JSON array string into an array of strings.
 * If the value starts with "[", parse as JSON array.
 * Otherwise, wrap in a single-element array.
 */
export function parseJsonArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  if (value.startsWith("[")) {
    try {
      return JSON.parse(value) as string[];
    } catch {
      return [value];
    }
  }
  return [value];
}

/**
 * Parse a JSON object string into a Record.
 * If the value starts with "{", parse as JSON object.
 * Otherwise, return undefined.
 */
export function parseJsonObject(
  value: string | undefined
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (value.startsWith("{")) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Parse a boolean string ("true"/"false") to a boolean value.
 */
export function parseBoolString(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value.toLowerCase() === "true";
}
