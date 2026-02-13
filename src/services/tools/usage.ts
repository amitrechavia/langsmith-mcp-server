/**
 * Tools for LangSmith billing/usage (trace counts). Uses REST API only.
 */

const DEFAULT_ENDPOINT = "https://api.smith.langchain.com";

/**
 * GET request to LangSmith API. Returns parsed JSON.
 */
async function request(
  apiKey: string,
  endpoint: string,
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown> | unknown[]> {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  let url = `${base}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      return { error: `HTTP ${response.status}: ${body}` };
    }

    return (await response.json()) as Record<string, unknown> | unknown[];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/**
 * GET /api/v1/workspaces
 */
async function listWorkspaces(
  apiKey: string,
  endpoint: string
): Promise<Record<string, unknown> | unknown[]> {
  return request(apiKey, endpoint, "/api/v1/workspaces");
}

/**
 * GET /api/v1/workspaces/{id}
 */
async function getWorkspaceById(
  apiKey: string,
  endpoint: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  const out = await request(
    apiKey,
    endpoint,
    `/api/v1/workspaces/${workspaceId}`
  );
  if (Array.isArray(out)) {
    return { error: "Unexpected response" };
  }
  return out;
}

/**
 * Build workspace_id -> name mapping. If singleWorkspace set, fetch only that one.
 */
async function buildWorkspaceIdToName(
  apiKey: string,
  endpoint: string,
  singleWorkspace: string | undefined
): Promise<Record<string, string>> {
  const idToName: Record<string, string> = {};

  if (singleWorkspace) {
    const trimmed = singleWorkspace.trim();
    // Check if it looks like a UUID
    if (trimmed.length === 36 && (trimmed.match(/-/g) || []).length === 4) {
      const resp = await getWorkspaceById(apiKey, endpoint, trimmed);
      if (!("error" in resp) && resp.id) {
        const name =
          (resp.display_name as string) ||
          (resp.name as string) ||
          trimmed;
        idToName[String(resp.id)] = name;
        return idToName;
      }
    }

    // Search by name in workspace list
    const wsResp = await listWorkspaces(apiKey, endpoint);
    let workspaces: Record<string, unknown>[] = [];
    if (Array.isArray(wsResp)) {
      workspaces = wsResp.filter(
        (w) => typeof w === "object" && w !== null
      ) as Record<string, unknown>[];
    } else if (typeof wsResp === "object" && !("error" in wsResp)) {
      workspaces = (
        (wsResp.workspaces as unknown[]) ||
        (wsResp.items as unknown[]) ||
        []
      ).filter(
        (w) => typeof w === "object" && w !== null
      ) as Record<string, unknown>[];
    }

    const singleLower = trimmed.toLowerCase();
    for (const w of workspaces) {
      if (!w.id) continue;
      const wid = String(w.id);
      const name =
        (w.display_name as string) || (w.name as string) || wid;
      if (
        wid === trimmed ||
        (name || "").toLowerCase() === singleLower
      ) {
        idToName[wid] = name;
        return idToName;
      }
    }
    return idToName;
  }

  // List all workspaces
  const wsResp = await listWorkspaces(apiKey, endpoint);
  let workspaces: Record<string, unknown>[] = [];
  if (Array.isArray(wsResp)) {
    workspaces = wsResp.filter(
      (w) => typeof w === "object" && w !== null
    ) as Record<string, unknown>[];
  } else if (
    typeof wsResp === "object" &&
    !("error" in (wsResp as Record<string, unknown>))
  ) {
    const respObj = wsResp as Record<string, unknown>;
    workspaces = (
      (respObj.workspaces as unknown[]) ||
      (respObj.items as unknown[]) ||
      []
    ).filter(
      (w) => typeof w === "object" && w !== null
    ) as Record<string, unknown>[];
  }

  for (const w of workspaces) {
    if (!w.id) continue;
    idToName[String(w.id)] =
      (w.display_name as string) || (w.name as string) || String(w.id);
  }

  return idToName;
}

/**
 * Put workspace_name next to each group value; optionally filter to one workspace.
 */
function augmentUsageGroupsWithNames(
  usage: Record<string, unknown>[],
  workspaceIdToName: Record<string, string>,
  onlyWorkspaceId?: string
): Record<string, unknown>[] {
  // Deep clone usage to avoid mutating the original
  const result = JSON.parse(
    JSON.stringify(usage)
  ) as Record<string, unknown>[];

  for (const item of result) {
    const groups = (item || {}).groups as Record<string, unknown> | undefined;
    if (typeof groups !== "object" || groups === null) continue;

    const newGroups: Record<string, unknown> = {};
    for (const [uid, val] of Object.entries(groups)) {
      if (onlyWorkspaceId && uid !== onlyWorkspaceId) continue;
      const name = workspaceIdToName[uid] || uid;
      newGroups[uid] = { workspace_name: name, value: val };
    }
    item.groups = newGroups;
  }

  return result;
}

/**
 * Fetch org billing usage (trace counts) with workspace names inline.
 *
 * @param apiKey - LangSmith API key
 * @param endpoint - API base URL
 * @param startingOn - Start of range (ISO 8601)
 * @param endingBefore - End of range (ISO 8601)
 * @param onCurrentPlan - If true, only usage on current plan
 * @param workspace - Optional single workspace UUID or name to filter to
 * @returns List of billing metrics or error dict
 */
export async function getBillingUsageTool(
  apiKey: string,
  endpoint: string,
  startingOn: string,
  endingBefore: string,
  onCurrentPlan: boolean = true,
  workspace?: string
): Promise<Record<string, unknown> | Record<string, unknown>[]> {
  const params: Record<string, string> = {
    starting_on: startingOn,
    ending_before: endingBefore,
    on_current_plan: onCurrentPlan ? "true" : "false",
  };

  const raw = await request(
    apiKey,
    endpoint,
    "/api/v1/orgs/current/billing/usage",
    params
  );

  if (!Array.isArray(raw)) {
    if (typeof raw === "object" && "error" in raw) {
      return raw;
    }
    return { error: "Unexpected billing usage response" };
  }

  if (raw.length === 0) {
    return { error: "Unexpected billing usage response" };
  }

  const workspaceIdToName = await buildWorkspaceIdToName(
    apiKey,
    endpoint,
    workspace
  );

  let onlyWorkspaceId: string | undefined;
  if (workspace && Object.keys(workspaceIdToName).length > 0) {
    onlyWorkspaceId = Object.keys(workspaceIdToName)[0];
  }

  return augmentUsageGroupsWithNames(
    raw as Record<string, unknown>[],
    workspaceIdToName,
    onlyWorkspaceId
  );
}
