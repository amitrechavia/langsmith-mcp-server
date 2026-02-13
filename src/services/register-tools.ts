/**
 * Registration module for LangSmith MCP tools.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getLangSmithClient,
  getApiKeyAndEndpoint,
  parseJsonArray,
  parseJsonObject,
  parseBoolString,
} from "../common/helpers.js";
import {
  listDatasetsTool,
  listExamplesTool,
  readDatasetTool,
  readExampleTool,
} from "./tools/datasets.js";
import { listExperimentsTool } from "./tools/experiments.js";
import { getPromptTool, listPromptsTool } from "./tools/prompts.js";
import {
  fetchRunsTool,
  getThreadHistoryTool,
  listProjectsTool,
} from "./tools/traces.js";
import { getBillingUsageTool } from "./tools/usage.js";

/**
 * Helper to return tool result as text content.
 */
function toolResult(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/**
 * Helper to return tool error result.
 */
function toolError(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

/**
 * Register all LangSmith tool-related functionality with the MCP server.
 */
export function registerTools(server: McpServer): void {
  // ── Prompt tools ──────────────────────────────────────────────────

  server.tool(
    "list_prompts",
    `Fetch prompts from LangSmith with optional filtering.

Args:
  is_public (str): Filter by prompt visibility - "true" for public prompts, "false" for private prompts (default: "false")
  limit (int): Maximum number of prompts to return (default: 20)

Returns:
  Dict with prompts and metadata`,
    {
      is_public: z
        .string()
        .optional()
        .default("false")
        .describe(
          'Filter by prompt visibility - "true" for public prompts, "false" for private prompts'
        ),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of prompts to return"),
    },
    async ({ is_public, limit }) => {
      try {
        const client = getLangSmithClient();
        const isPublicBool = is_public.toLowerCase() === "true";
        const result = await listPromptsTool(client, isPublicBool, limit);
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "get_prompt_by_name",
    `Get a specific prompt by its exact name.

Args:
  prompt_name (str): The exact name of the prompt to retrieve

Returns:
  Dict containing the prompt details and template, or an error message`,
    {
      prompt_name: z
        .string()
        .describe("The exact name of the prompt to retrieve"),
    },
    async ({ prompt_name }) => {
      try {
        const client = getLangSmithClient();
        const result = await getPromptTool(client, prompt_name);
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "push_prompt",
    `Call this tool when you need to understand how to create and push prompts to LangSmith.

This is a documentation-only tool that explains how to:
- Create prompts using LangChain's prompt templates
- Push prompts to LangSmith for version control and management
- Handle prompt creation vs. version updates

Use the LangSmith Client's push_prompt() method. See LangSmith documentation for details.`,
    {},
    async () => {
      return toolResult({
        documentation:
          "See LangSmith documentation for creating and pushing prompts. " +
          "Use the LangSmith Client's pushPrompt() method with a prompt identifier and object.",
      });
    }
  );

  // ── Thread / conversation tools ───────────────────────────────────

  server.tool(
    "get_thread_history",
    `Retrieve one page of message history for a specific conversation thread.

Uses char-based pagination: pages are built by character budget (max_chars_per_page).
Long strings are truncated to preview_chars. Supply page_number (1-based) on every call;
use the returned total_pages to request further pages.

Args:
  thread_id (str): The unique ID of the thread to fetch history for
  project_name (str): The name of the project containing the thread
  page_number (int): 1-based page index (required)
  max_chars_per_page (int): Max character count per page, capped at 30000 (default: 25000)
  preview_chars (int): Truncate long strings to this length (default: 150)

Returns:
  Dict with result (list of messages), page_number, total_pages, etc.`,
    {
      thread_id: z
        .string()
        .describe("The unique ID of the thread to fetch history for"),
      project_name: z
        .string()
        .describe("The name of the project containing the thread"),
      page_number: z.number().describe("1-based page index (required)"),
      max_chars_per_page: z
        .number()
        .optional()
        .default(25000)
        .describe("Max character count per page, capped at 30000"),
      preview_chars: z
        .number()
        .optional()
        .default(150)
        .describe("Truncate long strings to this length"),
    },
    async ({
      thread_id,
      project_name,
      page_number,
      max_chars_per_page,
      preview_chars,
    }) => {
      try {
        const client = getLangSmithClient();
        const result = await getThreadHistoryTool(
          client,
          thread_id,
          project_name,
          page_number,
          max_chars_per_page,
          preview_chars
        );
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Run / trace tools ─────────────────────────────────────────────

  server.tool(
    "fetch_runs",
    `Fetch LangSmith runs from one or more projects with flexible filters and automatic pagination.

All results are paginated by character budget to keep responses manageable. Use page_number
and total_pages from the response to iterate through multiple pages.

Args:
  project_name (str): The project name. For multiple projects, use JSON array string.
  limit (int): Max runs to fetch from LangSmith API (capped at 100). These runs are then paginated by character budget into pages.
  page_number (int): 1-based page index. Use with total_pages from response to iterate through pages.
  trace_id (str, optional): Return only runs that belong to this trace.
  run_type (str, optional): Filter by type: "llm", "chain", "tool", "retriever".
  error (str, optional): "true" for errored runs, "false" for successful.
  is_root (str, optional): "true" for only top-level traces.
  filter (str, optional): Filter Query Language (FQL) expression.
  trace_filter (str, optional): Filter applied to the root run.
  tree_filter (str, optional): Filter applied to any run in the trace tree.
  order_by (str, optional): Sort field; prefix with "-" for descending. Default "-start_time".
  reference_example_id (str, optional): Filter runs by reference example ID.
  max_chars_per_page (int): Max chars per page, capped at 30000. Default 25000.
  preview_chars (int): Truncate long strings to this length. Default 150.`,
    {
      project_name: z.string().describe("The project name to fetch runs from"),
      limit: z.number().describe("Maximum number of runs to fetch from LangSmith API (capped at 100)"),
      page_number: z.number().optional().default(1).describe("1-based page index"),
      trace_id: z
        .string()
        .optional()
        .describe("Return only runs belonging to this trace UUID"),
      run_type: z
        .string()
        .optional()
        .describe('Filter by type: "llm", "chain", "tool", "retriever"'),
      error: z
        .string()
        .optional()
        .describe('"true" for errored runs, "false" for successful'),
      is_root: z
        .string()
        .optional()
        .describe('"true" for only top-level traces'),
      filter: z
        .string()
        .optional()
        .describe("Filter Query Language (FQL) expression"),
      trace_filter: z
        .string()
        .optional()
        .describe("Filter applied to the root run in each trace tree"),
      tree_filter: z
        .string()
        .optional()
        .describe("Filter applied to any run in the trace tree"),
      order_by: z
        .string()
        .optional()
        .default("-start_time")
        .describe("Sort field; prefix with '-' for descending"),
      reference_example_id: z
        .string()
        .optional()
        .describe("Filter runs by reference example ID"),
      max_chars_per_page: z
        .number()
        .optional()
        .default(25000)
        .describe("Max character count per page, capped at 30000"),
      preview_chars: z
        .number()
        .optional()
        .default(150)
        .describe("Truncate long strings to this length"),
    },
    async ({
      project_name,
      limit,
      page_number,
      trace_id,
      run_type,
      error: errorStr,
      is_root,
      filter,
      trace_filter,
      tree_filter,
      order_by,
      reference_example_id,
      max_chars_per_page,
      preview_chars,
    }) => {
      try {
        const client = getLangSmithClient();

        let parsedProjectName: string | string[] = project_name;
        if (project_name && project_name.startsWith("[")) {
          try {
            parsedProjectName = JSON.parse(project_name) as string[];
          } catch {
            // keep as string
          }
        }

        const parsedError = parseBoolString(errorStr);
        const parsedIsRoot = parseBoolString(is_root);

        const result = await fetchRunsTool(client, {
          projectName: parsedProjectName,
          pageNumber: page_number,
          maxCharsPerPage: max_chars_per_page,
          previewChars: preview_chars,
          traceId: trace_id,
          runType: run_type,
          error: parsedError,
          isRoot: parsedIsRoot,
          filter,
          traceFilter: trace_filter,
          treeFilter: tree_filter,
          orderBy: order_by ?? "-start_time",
          limit,
          referenceExampleId: reference_example_id,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Project tools ─────────────────────────────────────────────────

  server.tool(
    "list_projects",
    `List LangSmith projects with optional filtering and detail level control.

Args:
  limit (int): Maximum number of projects to return (default: 5)
  project_name (str, optional): Filter projects by name (partial match)
  more_info (str): "true" for full details, "false" for simplified (default: "false")
  reference_dataset_id (str, optional): Filter by reference dataset ID
  reference_dataset_name (str, optional): Filter by reference dataset name`,
    {
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of projects to return"),
      project_name: z
        .string()
        .optional()
        .describe("Filter projects by name using partial matching"),
      more_info: z
        .string()
        .optional()
        .default("false")
        .describe('"true" for full details, "false" for simplified'),
      reference_dataset_id: z
        .string()
        .optional()
        .describe("Filter by reference dataset ID"),
      reference_dataset_name: z
        .string()
        .optional()
        .describe("Filter by reference dataset name"),
    },
    async ({
      limit,
      project_name,
      more_info,
      reference_dataset_id,
      reference_dataset_name,
    }) => {
      try {
        const client = getLangSmithClient();
        let parsedMoreInfo = more_info.toLowerCase() === "true";
        if (
          reference_dataset_id !== undefined &&
          reference_dataset_name !== undefined
        ) {
          parsedMoreInfo = true;
        }
        const result = await listProjectsTool(client, {
          limit,
          projectName: project_name,
          moreInfo: parsedMoreInfo,
          referenceDatasetId: reference_dataset_id,
          referenceDatasetName: reference_dataset_name,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Billing / usage tools ─────────────────────────────────────────

  server.tool(
    "get_billing_usage",
    `Fetch organization billing usage (trace counts) with workspace names inline.

Args:
  starting_on (str): Start of date range (ISO 8601)
  ending_before (str): End of date range (ISO 8601)
  workspace (str, optional): Optional workspace UUID or display name to filter
  on_current_plan (str): "true" to include only usage on current plan (default: "true")`,
    {
      starting_on: z
        .string()
        .describe("Start of date range (ISO 8601)"),
      ending_before: z
        .string()
        .describe("End of date range (ISO 8601)"),
      workspace: z
        .string()
        .optional()
        .describe("Optional workspace UUID or display name to filter"),
      on_current_plan: z
        .string()
        .optional()
        .default("true")
        .describe('"true" to include only usage on current plan'),
    },
    async ({ starting_on, ending_before, workspace, on_current_plan }) => {
      try {
        const [apiKey, endpoint] = getApiKeyAndEndpoint();
        const onCurrent = on_current_plan.toLowerCase() === "true";
        const result = await getBillingUsageTool(
          apiKey,
          endpoint,
          starting_on,
          ending_before,
          onCurrent,
          workspace
        );
        if (
          !Array.isArray(result) &&
          typeof result === "object" &&
          "error" in result
        ) {
          return toolResult(result);
        }
        return toolResult({ usage: result });
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Experiment tools ──────────────────────────────────────────────

  server.tool(
    "list_experiments",
    `List LangSmith experiment projects (reference projects) with mandatory dataset filtering.

Requires either reference_dataset_id or reference_dataset_name.

Args:
  reference_dataset_id (str, optional): Dataset ID to filter experiments by
  reference_dataset_name (str, optional): Dataset name to filter experiments by
  limit (int): Maximum number of experiments to return (default: 5)
  project_name (str, optional): Filter by name (partial match)`,
    {
      reference_dataset_id: z
        .string()
        .optional()
        .describe("The ID of the reference dataset to filter experiments by"),
      reference_dataset_name: z
        .string()
        .optional()
        .describe("The name of the reference dataset to filter experiments by"),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of experiments to return"),
      project_name: z
        .string()
        .optional()
        .describe("Filter projects by name using partial matching"),
    },
    async ({
      reference_dataset_id,
      reference_dataset_name,
      limit,
      project_name,
    }) => {
      try {
        const client = getLangSmithClient();
        const result = await listExperimentsTool(client, {
          referenceDatasetId: reference_dataset_id,
          referenceDatasetName: reference_dataset_name,
          limit,
          projectName: project_name,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Dataset tools ─────────────────────────────────────────────────

  server.tool(
    "list_datasets",
    `Fetch LangSmith datasets.

If no arguments are provided, all datasets will be returned.

Args:
  dataset_ids (str, optional): Dataset IDs as JSON array string or single ID
  data_type (str, optional): Filter by dataset data type (e.g., 'chat', 'kv')
  dataset_name (str, optional): Filter by exact dataset name
  dataset_name_contains (str, optional): Filter by substring in dataset name
  metadata (str, optional): Filter by metadata as JSON object string
  limit (int): Max number of datasets to return (default: 20)`,
    {
      dataset_ids: z
        .string()
        .optional()
        .describe("Dataset IDs as JSON array string or single ID"),
      data_type: z
        .string()
        .optional()
        .describe("Filter by dataset data type"),
      dataset_name: z
        .string()
        .optional()
        .describe("Filter by exact dataset name"),
      dataset_name_contains: z
        .string()
        .optional()
        .describe("Filter by substring in dataset name"),
      metadata: z
        .string()
        .optional()
        .describe("Filter by metadata as JSON object string"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max number of datasets to return"),
    },
    async ({
      dataset_ids,
      data_type,
      dataset_name,
      dataset_name_contains,
      metadata,
      limit,
    }) => {
      try {
        const client = getLangSmithClient();
        const parsedDatasetIds = parseJsonArray(dataset_ids);
        const parsedMetadata = parseJsonObject(metadata);

        const result = await listDatasetsTool(client, {
          datasetIds: parsedDatasetIds,
          dataType: data_type,
          datasetName: dataset_name,
          datasetNameContains: dataset_name_contains,
          metadata: parsedMetadata,
          limit,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "list_examples",
    `Fetch examples from a LangSmith dataset with advanced filtering options.

Either dataset_id, dataset_name, or example_ids must be provided.

Args:
  dataset_id (str, optional): Dataset ID to retrieve examples from
  dataset_name (str, optional): Dataset name to retrieve examples from
  example_ids (str, optional): Example IDs as JSON array string or single ID
  filter (str, optional): Filter string using LangSmith query syntax
  metadata (str, optional): Metadata filter as JSON object string
  splits (str, optional): Dataset splits as JSON array string or single split
  inline_s3_urls (str, optional): "true" or "false"
  include_attachments (str, optional): "true" or "false"
  as_of (str, optional): Dataset version tag or ISO timestamp
  limit (int): Max examples to return (default: 10)
  offset (str, optional): Number of examples to skip`,
    {
      dataset_id: z
        .string()
        .optional()
        .describe("Dataset ID to retrieve examples from"),
      dataset_name: z
        .string()
        .optional()
        .describe("Dataset name to retrieve examples from"),
      example_ids: z
        .string()
        .optional()
        .describe("Example IDs as JSON array string or single ID"),
      filter: z
        .string()
        .optional()
        .describe("Filter string using LangSmith query syntax"),
      metadata: z
        .string()
        .optional()
        .describe("Metadata filter as JSON object string"),
      splits: z
        .string()
        .optional()
        .describe("Dataset splits as JSON array string or single split"),
      inline_s3_urls: z
        .string()
        .optional()
        .describe('"true" or "false"'),
      include_attachments: z
        .string()
        .optional()
        .describe('"true" or "false"'),
      as_of: z
        .string()
        .optional()
        .describe("Dataset version tag or ISO timestamp"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of examples to return"),
      offset: z
        .string()
        .optional()
        .describe("Number of examples to skip"),
    },
    async ({
      dataset_id,
      dataset_name,
      example_ids,
      filter,
      metadata,
      splits,
      inline_s3_urls,
      include_attachments,
      as_of,
      limit,
      offset,
    }) => {
      try {
        const client = getLangSmithClient();
        const parsedExampleIds = parseJsonArray(example_ids);
        const parsedSplits = parseJsonArray(splits);
        const parsedMetadata = parseJsonObject(metadata);
        const parsedInlineS3Urls = parseBoolString(inline_s3_urls);
        const parsedIncludeAttachments = parseBoolString(include_attachments);
        const parsedOffset = offset ? parseInt(offset, 10) : undefined;

        const result = await listExamplesTool(client, {
          datasetId: dataset_id,
          datasetName: dataset_name,
          exampleIds: parsedExampleIds,
          filter,
          metadata: parsedMetadata,
          splits: parsedSplits,
          inlineS3Urls: parsedInlineS3Urls,
          includeAttachments: parsedIncludeAttachments,
          asOf: as_of,
          limit,
          offset: parsedOffset,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "read_dataset",
    `Read a specific dataset from LangSmith.

Either dataset_id or dataset_name must be provided.

Args:
  dataset_id (str, optional): Dataset ID to retrieve
  dataset_name (str, optional): Dataset name to retrieve`,
    {
      dataset_id: z.string().optional().describe("Dataset ID to retrieve"),
      dataset_name: z
        .string()
        .optional()
        .describe("Dataset name to retrieve"),
    },
    async ({ dataset_id, dataset_name }) => {
      try {
        const client = getLangSmithClient();
        const result = await readDatasetTool(client, {
          datasetId: dataset_id,
          datasetName: dataset_name,
        });
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.tool(
    "read_example",
    `Read a specific example from LangSmith.

Args:
  example_id (str): Example ID to retrieve
  as_of (str, optional): Dataset version tag or ISO timestamp`,
    {
      example_id: z.string().describe("Example ID to retrieve"),
      as_of: z
        .string()
        .optional()
        .describe("Dataset version tag or ISO timestamp"),
    },
    async ({ example_id, as_of }) => {
      try {
        const client = getLangSmithClient();
        const result = await readExampleTool(client, example_id, as_of);
        return toolResult(result);
      } catch (e: unknown) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── Documentation-only tools ──────────────────────────────────────

  server.tool(
    "create_dataset",
    `Call this tool when you need to understand how to create datasets in LangSmith.
This is a documentation-only tool.`,
    {},
    async () => {
      return toolResult({
        documentation:
          "See LangSmith documentation for creating datasets. " +
          "Use the LangSmith Client's createDataset() and createExamples() methods.",
      });
    }
  );

  server.tool(
    "update_examples",
    `Call this tool when you need to understand how to update dataset examples in LangSmith.
This is a documentation-only tool.`,
    {},
    async () => {
      return toolResult({
        documentation:
          "See LangSmith documentation for updating examples. " +
          "Use the LangSmith Client's updateExample() or updateExamples() methods.",
      });
    }
  );

  server.tool(
    "run_experiment",
    `Call this tool when you need to understand how to run experiments and evaluations in LangSmith.
This is a documentation-only tool.`,
    {},
    async () => {
      return toolResult({
        documentation:
          "See LangSmith documentation for running experiments. " +
          "Use the LangSmith Client's evaluate() method with custom evaluators.",
      });
    }
  );
}
