/**
 * Tools for interacting with LangSmith traces and conversations.
 */

import { Client } from "langsmith";
import { convertToSerializable, findInDict } from "../../common/helpers.js";
import {
  paginateMessages,
  paginateRuns,
} from "../../common/pagination.js";

/** LangSmith API maximum for list_runs limit */
const LANGSMITH_LIST_RUNS_MAX_LIMIT = 100;

/** Hard cap for trace pagination: pages cannot exceed this character budget */
const MAX_CHARS_PER_PAGE_TRACE = 30000;

/**
 * Fetch the trace content for a specific project or specify a trace ID.
 *
 * Note: Only one of the parameters (projectName or traceId) is required.
 * traceId is preferred if both are provided.
 *
 * @param client - LangSmith client instance
 * @param projectName - The name of the project to fetch the last trace for
 * @param traceId - The ID of the trace to fetch (preferred parameter)
 * @returns Dictionary containing the last trace and metadata
 */
export async function fetchTraceTool(
  client: Client,
  projectName?: string,
  traceId?: string
): Promise<Record<string, unknown>> {
  // Handle "null" string inputs
  if (projectName === "null") projectName = undefined;
  if (traceId === "null") traceId = undefined;

  if (!projectName && !traceId) {
    return {
      error: "Error: Either project_name or trace_id must be provided.",
    };
  }

  try {
    const runs: Record<string, unknown>[] = [];
    for await (const run of client.listRuns({
      projectName: projectName || undefined,
      id: traceId ? [traceId] : undefined,
      select: [
        "inputs",
        "outputs",
        "run_type",
        "id",
        "error",
        "total_tokens",
        "total_cost",
        "feedback_stats",
        "app_path",
        "thread_id",
      ],
      isRoot: true,
      limit: 1,
    })) {
      runs.push(convertToSerializable(run) as Record<string, unknown>);
    }

    if (runs.length === 0) {
      return {
        error: `No runs found for project_name: ${projectName}`,
      };
    }

    const run = runs[0];
    return {
      trace_id: run.id != null ? String(run.id) : null,
      run_type: run.run_type,
      id: run.id != null ? String(run.id) : null,
      error: run.error,
      inputs: run.inputs,
      outputs: run.outputs,
      total_tokens: run.total_tokens,
      total_cost: run.total_cost != null ? String(run.total_cost) : null,
      feedback_stats: run.feedback_stats,
      app_path: run.app_path,
      thread_id: run.thread_id != null ? String(run.thread_id) : null,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching last trace: ${message}` };
  }
}

/**
 * Extract messages from a single run's inputs and outputs.
 */
function messagesFromRun(run: Record<string, unknown>): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  const inputs = run.inputs as Record<string, unknown> | undefined;
  if (inputs && "messages" in inputs && Array.isArray(inputs.messages)) {
    messages.push(
      ...(inputs.messages as Record<string, unknown>[])
    );
  }

  const outputs = run.outputs as Record<string, unknown> | undefined;
  if (outputs) {
    if ("choices" in outputs && Array.isArray(outputs.choices)) {
      const choices = outputs.choices as Record<string, unknown>[];
      if (choices.length > 0 && "message" in choices[0]) {
        messages.push(choices[0].message as Record<string, unknown>);
      }
    } else if ("message" in outputs) {
      messages.push(outputs.message as Record<string, unknown>);
    }
  }

  return messages;
}

/**
 * Get one page of message history for a specific thread (char-based pagination).
 *
 * @param client - LangSmith client instance
 * @param threadId - The ID of the thread to fetch history for
 * @param projectName - The name of the project containing the thread
 * @param pageNumber - 1-based page index (required)
 * @param maxCharsPerPage - Max character count per page (capped at 30000)
 * @param previewChars - Truncate long strings to this length
 * @returns Dict with result, page_number, total_pages, etc.
 */
export async function getThreadHistoryTool(
  client: Client,
  threadId: string,
  projectName: string,
  pageNumber: number,
  maxCharsPerPage: number = 25000,
  previewChars: number = 150
): Promise<Record<string, unknown>> {
  try {
    maxCharsPerPage = Math.min(maxCharsPerPage, MAX_CHARS_PER_PAGE_TRACE);

    const filterString =
      `and(in(metadata_key, ["session_id","conversation_id","thread_id"]), ` +
      `eq(metadata_value, "${threadId}"))`;

    const runs: Record<string, unknown>[] = [];
    for await (const run of client.listRuns({
      projectName,
      filter: filterString,
      runType: "llm",
      limit: LANGSMITH_LIST_RUNS_MAX_LIMIT,
    })) {
      runs.push(convertToSerializable(run) as Record<string, unknown>);
    }

    if (runs.length === 0) {
      return {
        error: `No runs found for thread ${threadId} in project ${projectName}`,
      };
    }

    // Chronological order (oldest first) for history
    runs.sort((a, b) => {
      const aTime = String(a.start_time ?? "");
      const bTime = String(b.start_time ?? "");
      return aTime.localeCompare(bTime);
    });

    const allMessages: Record<string, unknown>[] = [];
    for (const run of runs) {
      allMessages.push(...messagesFromRun(run));
    }

    if (allMessages.length === 0) {
      return {
        error: `No messages found in the runs for thread ${threadId}`,
      };
    }

    return paginateMessages(allMessages, pageNumber, maxCharsPerPage, previewChars);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error fetching thread history: ${message}` };
  }
}

/**
 * Get the project runs stats.
 *
 * Note: Only one of the parameters (projectName or traceId) is required.
 * traceId is preferred if both are provided.
 *
 * @param client - LangSmith client instance
 * @param projectName - The name of the project to fetch the runs stats for
 * @param traceId - The ID of the trace to fetch (preferred parameter)
 * @returns Dictionary containing the project runs stats
 */
export async function getProjectRunsStatsTool(
  client: Client,
  projectName?: string,
  traceId?: string
): Promise<Record<string, unknown>> {
  // Handle "null" string inputs
  if (projectName === "null") projectName = undefined;
  if (traceId === "null") traceId = undefined;

  if (!projectName && !traceId) {
    return {
      error: "Error: Either project_name or trace_id must be provided.",
    };
  }

  try {
    // Break down the qualified project name
    const parts = (projectName || "").split("/");
    const isQualified = parts.length === 2;
    const actualProjectName = isQualified ? parts[1] : projectName;

    const projectRunsStats = (await client.getRunStats({
      projectNames: actualProjectName ? [actualProjectName] : undefined,
      trace: traceId || undefined,
    })) as Record<string, unknown>;

    // Remove run_facets from the response
    delete projectRunsStats.run_facets;
    // Add project_name to the response
    projectRunsStats.project_name = actualProjectName;

    return projectRunsStats;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Error getting project runs stats: ${message}` };
  }
}

/**
 * List projects from LangSmith.
 *
 * @param client - LangSmith Client instance
 * @param options - Filtering options
 * @returns Dictionary containing a "projects" key with project dictionaries
 */
export async function listProjectsTool(
  client: Client,
  options: {
    limit?: number;
    projectName?: string;
    moreInfo?: boolean;
    referenceDatasetId?: string;
    referenceDatasetName?: string;
  } = {}
): Promise<Record<string, unknown>> {
  const {
    limit = 5,
    projectName,
    moreInfo = false,
    referenceDatasetId,
    referenceDatasetName,
  } = options;

  const projects: Record<string, unknown>[] = [];
  let count = 0;
  for await (const project of client.listProjects({
    referenceFree: true,
    nameContains: projectName,
    referenceDatasetId,
    referenceDatasetName,
  })) {
    if (count >= limit) break;
    projects.push(convertToSerializable(project) as Record<string, unknown>);
    count++;
  }

  if (moreInfo) {
    return { projects };
  }

  const simpleProjects: Record<string, unknown>[] = [];
  for (const project of projects) {
    const deploymentId = findInDict(project, "deployment_id");
    const projectId = project.id ?? null;
    const projectDict: Record<string, unknown> = {
      name: project.name ?? null,
      project_id: projectId !== null ? String(projectId) : null,
    };
    if (deploymentId) {
      projectDict.agent_deployment_id = deploymentId;
    }
    simpleProjects.push(projectDict);
  }

  return { projects: simpleProjects };
}

/**
 * Fetch LangSmith runs with flexible filters and automatic pagination.
 * Results are always paginated by character budget.
 *
 * @param client - LangSmith client instance
 * @param options - Run query and pagination options
 * @returns Dictionary with runs, page_number, total_pages, max_chars_per_page, preview_chars.
 *          May include _truncated, _truncated_message, _truncated_preview if content was cut.
 */
export async function fetchRunsTool(
  client: Client,
  options: {
    projectName: string | string[];
    pageNumber?: number;
    maxCharsPerPage?: number;
    previewChars?: number;
    traceId?: string;
    runType?: string;
    error?: boolean;
    isRoot?: boolean;
    filter?: string;
    traceFilter?: string;
    treeFilter?: string;
    orderBy?: string;
    limit?: number;
    referenceExampleId?: string;
  }
): Promise<Record<string, unknown>> {
  const {
    projectName,
    pageNumber = 1,
    previewChars = 150,
    traceId,
    runType,
    error,
    isRoot,
    filter,
    traceFilter,
    treeFilter,
    orderBy = "-start_time",
    referenceExampleId,
  } = options;

  let maxCharsPerPage = Math.min(
    options.maxCharsPerPage ?? 25000,
    MAX_CHARS_PER_PAGE_TRACE
  );

  const cappedLimit = Math.min(
    options.limit ?? LANGSMITH_LIST_RUNS_MAX_LIMIT,
    LANGSMITH_LIST_RUNS_MAX_LIMIT
  );

  // Convert order_by string (e.g. "-start_time") to JS SDK's "asc"/"desc"
  const order: "asc" | "desc" | undefined =
    orderBy?.startsWith("-") ? "desc" : orderBy ? "asc" : undefined;

  const runsDict: Record<string, unknown>[] = [];
  for await (const run of client.listRuns({
    projectName,
    traceId,
    runType,
    error,
    isRoot,
    filter,
    traceFilter,
    treeFilter,
    order,
    limit: cappedLimit,
    referenceExampleId,
  })) {
    const runDict = convertToSerializable(run) as Record<string, unknown>;
    runsDict.push(runDict);
  }

  // Always paginate the results
  return paginateRuns(runsDict, pageNumber, maxCharsPerPage, previewChars);
}
