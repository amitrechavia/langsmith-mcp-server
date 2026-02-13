/**
 * Char-based pagination for LangSmith runs.
 *
 * Stateless: each request fetches all runs for the trace (up to a safe bound),
 * builds pages by character budget, and returns the requested page only.
 * No cursor, no offset, no server-side state. Optimized for LLM callers (simple integers).
 */

/** LangSmith API maximum; do not exceed */
export const MAX_RUNS_PER_TRACE = 100;

/**
 * Recursively truncate long strings to previewChars; suffix with "... (+N chars)".
 */
export function truncateStrings(obj: unknown, previewChars: number): unknown {
  if (previewChars <= 0) {
    return obj;
  }
  if (typeof obj === "string") {
    if (obj.length <= previewChars) {
      return obj;
    }
    return (
      obj.slice(0, previewChars) +
      "\u2026 (+" +
      (obj.length - previewChars) +
      " chars)"
    );
  }
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = truncateStrings(v, previewChars);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => truncateStrings(item, previewChars));
  }
  return obj;
}

/**
 * Character count of JSON-serialized run (for budget).
 */
function runCharCount(runDict: Record<string, unknown>): number {
  return JSON.stringify(runDict, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  ).length;
}

/**
 * Character count of the full page JSON. Use indent=0 for compact (budget-friendly).
 */
function pageOutputSize(
  pageDict: Record<string, unknown>,
  indent: number = 0
): number {
  return JSON.stringify(
    pageDict,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    indent || undefined
  ).length;
}

interface PageDict extends Record<string, unknown> {
  page_number: number;
  total_pages: number;
  max_chars_per_page: number;
  preview_chars?: number;
}

/**
 * If the page JSON exceeds maxCharsPerPage, truncate long strings inside
 * pageDict[itemsKey] until the serialized output fits.
 * If still over budget, return a dict with itemsKey=[] and _truncated_preview.
 */
function enforcePageCharBudget(
  pageDict: PageDict,
  maxCharsPerPage: number,
  options: { indent?: number; itemsKey?: string } = {}
): PageDict {
  const { indent = 0, itemsKey = "runs" } = options;

  if (pageOutputSize(pageDict, indent) <= maxCharsPerPage) {
    return pageDict;
  }

  const items = pageDict[itemsKey] as Record<string, unknown>[] | undefined;
  if (!items || items.length === 0) {
    return pageDict;
  }

  let low = 0;
  let high = 100_000;
  let bestPageDict: PageDict = pageDict;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const truncatedItems = items.map(
      (it) => truncateStrings(it, mid) as Record<string, unknown>
    );
    const testDict: PageDict = { ...pageDict, [itemsKey]: truncatedItems };
    const size = pageOutputSize(testDict, indent);

    if (size <= maxCharsPerPage) {
      bestPageDict = testDict;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const bestSize = pageOutputSize(bestPageDict, indent);
  if (bestSize > maxCharsPerPage) {
    const jsonStr = JSON.stringify(
      bestPageDict,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      indent || undefined
    );
    const suffix = "\n\u2026 (output truncated, exceeded max_chars_per_page)";
    const overhead = 1000;
    const safePreviewLen = (maxCharsPerPage - suffix.length - overhead) / 2;
    const previewMax = Math.max(100, safePreviewLen);
    const truncatedPreview = jsonStr.slice(0, previewMax) + suffix;

    return {
      ...Object.fromEntries(
        Object.entries(pageDict).filter(([k]) => k !== itemsKey)
      ),
      [itemsKey]: [],
      page_number: pageDict.page_number,
      total_pages: pageDict.total_pages,
      max_chars_per_page: maxCharsPerPage,
      preview_chars: pageDict.preview_chars ?? 0,
      _truncated: true,
      _truncated_message: "Page exceeded character budget; content truncated.",
      _truncated_preview: truncatedPreview,
    };
  }

  return bestPageDict;
}

/**
 * Split runs into pages by character budget (JSON length).
 * If a single run exceeds the budget, it is returned alone on a page.
 */
export function buildPagesByCharBudget(
  runsDict: Record<string, unknown>[],
  maxCharsPerPage: number
): Record<string, unknown>[][] {
  if (runsDict.length === 0) {
    return [];
  }

  const pages: Record<string, unknown>[][] = [];
  let currentPage: Record<string, unknown>[] = [];
  let currentChars = 0;

  for (const run of runsDict) {
    const runChars = runCharCount(run);
    if (currentChars + runChars > maxCharsPerPage && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentChars = 0;
    }
    currentPage.push(run);
    currentChars += runChars;
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

/**
 * Return one page of runs (char-based pagination).
 *
 * - Applies previewChars truncation to each run if previewChars > 0.
 * - Builds pages by accumulating JSON length up to maxCharsPerPage.
 * - pageNumber is 1-based. Out-of-range returns empty runs.
 * - Ensures the returned page JSON never exceeds maxCharsPerPage.
 *
 * @returns Dict with keys: runs, page_number, total_pages, max_chars_per_page, preview_chars.
 *          May include _truncated, _truncated_message, _truncated_preview if content was cut.
 */
export function paginateRuns(
  runsDict: Record<string, unknown>[],
  pageNumber: number,
  maxCharsPerPage: number,
  previewChars: number = 0
): Record<string, unknown> {
  if (previewChars > 0) {
    runsDict = runsDict.map(
      (r) => truncateStrings(r, previewChars) as Record<string, unknown>
    );
  }

  const pages = buildPagesByCharBudget(runsDict, maxCharsPerPage);
  const totalPages = pages.length;

  let pageRuns: Record<string, unknown>[];
  if (pageNumber < 1 || pageNumber > totalPages) {
    pageRuns = [];
  } else {
    pageRuns = pages[pageNumber - 1];
  }

  const out: PageDict = {
    runs: pageRuns,
    page_number: pageNumber,
    total_pages: totalPages,
    max_chars_per_page: maxCharsPerPage,
    preview_chars: previewChars,
  };

  return enforcePageCharBudget(out, maxCharsPerPage);
}

/**
 * Return one page of messages (char-based pagination), same semantics as paginateRuns.
 * Uses "result" as the key for the message list.
 */
export function paginateMessages(
  messagesDict: Record<string, unknown>[],
  pageNumber: number,
  maxCharsPerPage: number,
  previewChars: number = 0
): Record<string, unknown> {
  if (previewChars > 0) {
    messagesDict = messagesDict.map(
      (m) => truncateStrings(m, previewChars) as Record<string, unknown>
    );
  }

  const pages = buildPagesByCharBudget(messagesDict, maxCharsPerPage);
  const totalPages = pages.length;

  let pageMessages: Record<string, unknown>[];
  if (pageNumber < 1 || pageNumber > totalPages) {
    pageMessages = [];
  } else {
    pageMessages = pages[pageNumber - 1];
  }

  const out: PageDict = {
    result: pageMessages,
    page_number: pageNumber,
    total_pages: totalPages,
    max_chars_per_page: maxCharsPerPage,
    preview_chars: previewChars,
  };

  return enforcePageCharBudget(out, maxCharsPerPage, { itemsKey: "result" });
}
