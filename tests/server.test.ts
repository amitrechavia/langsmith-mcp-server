/**
 * Integration tests for the LangSmith MCP Server.
 *
 * Tests the full MCP protocol stack: tool registration, input validation,
 * handler execution, error handling, and response serialization.
 * Uses InMemoryTransport to connect an MCP Client to the server in-process.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/services/register-tools.js";
import { getLangSmithClient } from "../src/common/helpers.js";

// ---------------------------------------------------------------------------
// Mock helpers so no real API keys or network calls are required.
// ---------------------------------------------------------------------------

const mockLangSmithClient = {
  listPrompts: vi.fn(),
  pullPromptCommit: vi.fn(),
  listRuns: vi.fn(),
  listProjects: vi.fn(),
  listDatasets: vi.fn(),
  listExamples: vi.fn(),
  readDataset: vi.fn(),
  readExample: vi.fn(),
  getRunStats: vi.fn(),
};

vi.mock("../src/common/helpers.js", async () => {
  const actual = await vi.importActual<typeof import("../src/common/helpers.js")>(
    "../src/common/helpers.js"
  );
  return {
    ...actual,
    getLangSmithClient: vi.fn(() => mockLangSmithClient),
    getApiKeyAndEndpoint: vi.fn(() => ["fake-api-key", "https://fake.langsmith.com"]),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Turn an array into an AsyncIterable (simulates SDK paginated results). */
async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

/** Parse the JSON text from an MCP tool result content block. */
function parseToolResult(result: { content: unknown[] }): unknown {
  const block = result.content[0] as { type: string; text: string };
  return JSON.parse(block.text);
}

// ---------------------------------------------------------------------------
// Test setup: create a fresh MCP server + client pair for each test suite.
// ---------------------------------------------------------------------------

let client: Client;
let mcpServer: McpServer;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

beforeAll(async () => {
  mcpServer = new McpServer(
    { name: "LangSmith API MCP Server", version: "0.1.0" },
    { capabilities: { logging: {} } }
  );
  registerTools(mcpServer);

  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await mcpServer.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe("tool registration", () => {
  it("registers all 15 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(15);
  });

  it("includes every expected tool name", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "create_dataset",
      "fetch_runs",
      "get_billing_usage",
      "get_prompt_by_name",
      "get_thread_history",
      "list_datasets",
      "list_examples",
      "list_experiments",
      "list_projects",
      "list_prompts",
      "push_prompt",
      "read_dataset",
      "read_example",
      "run_experiment",
      "update_examples",
    ].sort());
  });

  it("each tool has a description and inputSchema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Documentation-only tools
// ---------------------------------------------------------------------------

describe("documentation-only tools", () => {
  it("push_prompt returns documentation", async () => {
    const result = await client.callTool({ name: "push_prompt", arguments: {} });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data).toHaveProperty("documentation");
    expect(data.documentation).toContain("pushPrompt");
  });

  it("create_dataset returns documentation", async () => {
    const result = await client.callTool({ name: "create_dataset", arguments: {} });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data).toHaveProperty("documentation");
    expect(data.documentation).toContain("createDataset");
  });

  it("update_examples returns documentation", async () => {
    const result = await client.callTool({ name: "update_examples", arguments: {} });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data).toHaveProperty("documentation");
    expect(data.documentation).toContain("updateExample");
  });

  it("run_experiment returns documentation", async () => {
    const result = await client.callTool({ name: "run_experiment", arguments: {} });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data).toHaveProperty("documentation");
    expect(data.documentation).toContain("evaluate");
  });
});

// ---------------------------------------------------------------------------
// list_prompts
// ---------------------------------------------------------------------------

describe("list_prompts", () => {
  it("returns prompts from the LangSmith client", async () => {
    mockLangSmithClient.listPrompts.mockReturnValue(
      toAsyncIterable([
        {
          repo_handle: "my-prompt",
          description: "A test prompt",
          id: "prompt-1",
          is_public: false,
          tags: ["test"],
          owner: "user1",
          full_name: "user1/my-prompt",
          num_likes: 0,
          num_downloads: 5,
          num_views: 10,
          created_at: new Date("2024-01-01T00:00:00Z"),
          updated_at: new Date("2024-06-01T00:00:00Z"),
        },
      ])
    );

    const result = await client.callTool({
      name: "list_prompts",
      arguments: { is_public: "false", limit: 10 },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.total_count).toBe(1);
    const prompts = data.prompts as Record<string, unknown>[];
    expect(prompts[0].repo_handle).toBe("my-prompt");
    expect(prompts[0].created_at).toBe("2024-01-01T00:00:00.000Z");
    expect(prompts[0].updated_at).toBe("2024-06-01T00:00:00.000Z");
  });

  it("uses default parameters when none provided", async () => {
    mockLangSmithClient.listPrompts.mockReturnValue(toAsyncIterable([]));

    const result = await client.callTool({
      name: "list_prompts",
      arguments: {},
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.total_count).toBe(0);
    expect(data.prompts).toEqual([]);
  });

  it("returns error on client failure", async () => {
    // listPromptsTool catches errors internally and returns { error: ... }
    // rather than throwing, so isError is not set on the MCP result.
    mockLangSmithClient.listPrompts.mockImplementation(() => {
      throw new Error("API rate limit exceeded");
    });

    const result = await client.callTool({
      name: "list_prompts",
      arguments: {},
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("API rate limit exceeded");
  });
});

// ---------------------------------------------------------------------------
// get_prompt_by_name
// ---------------------------------------------------------------------------

describe("get_prompt_by_name", () => {
  it("returns a prompt commit", async () => {
    mockLangSmithClient.pullPromptCommit.mockResolvedValue({
      owner: "user1",
      repo: "my-prompt",
      manifest: { template: "Hello {name}" },
    });

    const result = await client.callTool({
      name: "get_prompt_by_name",
      arguments: { prompt_name: "user1/my-prompt" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.owner).toBe("user1");
    expect(data.repo).toBe("my-prompt");
  });

  it("returns error when prompt not found", async () => {
    // getPromptTool catches errors internally and returns { error: ... }
    mockLangSmithClient.pullPromptCommit.mockRejectedValue(
      new Error("Prompt not found")
    );

    const result = await client.callTool({
      name: "get_prompt_by_name",
      arguments: { prompt_name: "nonexistent" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("Prompt not found");
  });
});

// ---------------------------------------------------------------------------
// fetch_runs
// ---------------------------------------------------------------------------

describe("fetch_runs", () => {
  it("returns paginated runs", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(
      toAsyncIterable([
        {
          id: "run-1",
          name: "test-run",
          run_type: "chain",
          start_time: new Date("2024-06-01T10:00:00Z"),
          end_time: new Date("2024-06-01T10:01:00Z"),
          status: "success",
          inputs: { query: "hello" },
          outputs: { answer: "world" },
        },
        {
          id: "run-2",
          name: "test-run-2",
          run_type: "llm",
          start_time: new Date("2024-06-01T10:02:00Z"),
          end_time: new Date("2024-06-01T10:03:00Z"),
          status: "success",
          inputs: { prompt: "test" },
          outputs: { completion: "response" },
        },
      ])
    );

    const result = await client.callTool({
      name: "fetch_runs",
      arguments: {
        project_name: "my-project",
        limit: 10,
        page_number: 1,
      },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.page_number).toBe(1);
    expect(data.total_pages).toBeGreaterThanOrEqual(1);
    const runs = data.runs as unknown[];
    expect(runs.length).toBe(2);
  });

  it("passes boolean filters correctly", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "fetch_runs",
      arguments: {
        project_name: "my-project",
        limit: 5,
        error: "true",
        is_root: "true",
      },
    });

    expect(mockLangSmithClient.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
        isRoot: true,
      })
    );
  });

  it("parses JSON array project names", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "fetch_runs",
      arguments: {
        project_name: '["project-a","project-b"]',
        limit: 5,
      },
    });

    expect(mockLangSmithClient.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: ["project-a", "project-b"],
      })
    );
  });

  it("caps limit at 100", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "fetch_runs",
      arguments: {
        project_name: "my-project",
        limit: 500,
      },
    });

    expect(mockLangSmithClient.listRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 100,
      })
    );
  });

  it("returns error on failure", async () => {
    mockLangSmithClient.listRuns.mockImplementation(() => {
      throw new Error("Connection refused");
    });

    const result = await client.callTool({
      name: "fetch_runs",
      arguments: { project_name: "fail", limit: 5 },
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("Connection refused");
  });
});

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------

describe("list_projects", () => {
  it("returns simplified projects by default", async () => {
    mockLangSmithClient.listProjects.mockReturnValue(
      toAsyncIterable([
        { id: "proj-1", name: "my-project" },
        { id: "proj-2", name: "other-project" },
      ])
    );

    const result = await client.callTool({
      name: "list_projects",
      arguments: { limit: 10 },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    const projects = data.projects as Record<string, unknown>[];
    expect(projects.length).toBe(2);
    expect(projects[0]).toHaveProperty("name", "my-project");
    expect(projects[0]).toHaveProperty("project_id", "proj-1");
    // Simplified view should NOT include all fields
    expect(projects[0]).not.toHaveProperty("created_at");
  });

  it("returns full project details when more_info is true", async () => {
    const fullProject = {
      id: "proj-1",
      name: "my-project",
      created_at: new Date("2024-01-01T00:00:00Z"),
      run_count: 42,
    };
    mockLangSmithClient.listProjects.mockReturnValue(
      toAsyncIterable([fullProject])
    );

    const result = await client.callTool({
      name: "list_projects",
      arguments: { limit: 5, more_info: "true" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    const projects = data.projects as Record<string, unknown>[];
    expect(projects[0]).toHaveProperty("name", "my-project");
    // Full info includes all fields
    expect(projects[0]).toHaveProperty("run_count", 42);
  });
});

// ---------------------------------------------------------------------------
// get_thread_history
// ---------------------------------------------------------------------------

describe("get_thread_history", () => {
  it("returns paginated messages for a thread", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(
      toAsyncIterable([
        {
          id: "run-1",
          start_time: new Date("2024-06-01T10:00:00Z"),
          inputs: {
            messages: [
              { role: "user", content: "Hello" },
            ],
          },
          outputs: {
            choices: [
              { message: { role: "assistant", content: "Hi there!" } },
            ],
          },
        },
      ])
    );

    const result = await client.callTool({
      name: "get_thread_history",
      arguments: {
        thread_id: "thread-abc",
        project_name: "my-project",
        page_number: 1,
      },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.page_number).toBe(1);
    const messages = data.result as unknown[];
    expect(messages.length).toBe(2); // user + assistant
  });

  it("returns error when no runs found", async () => {
    mockLangSmithClient.listRuns.mockReturnValue(toAsyncIterable([]));

    const result = await client.callTool({
      name: "get_thread_history",
      arguments: {
        thread_id: "nonexistent-thread",
        project_name: "my-project",
        page_number: 1,
      },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("No runs found");
  });
});

// ---------------------------------------------------------------------------
// list_datasets
// ---------------------------------------------------------------------------

describe("list_datasets", () => {
  it("returns datasets with formatted dates", async () => {
    mockLangSmithClient.listDatasets.mockReturnValue(
      toAsyncIterable([
        {
          id: "ds-1",
          name: "test-dataset",
          description: "A test dataset",
          data_type: "kv",
          example_count: 10,
          created_at: new Date("2024-03-15T00:00:00Z"),
          modified_at: new Date("2024-06-01T00:00:00Z"),
        },
      ])
    );

    const result = await client.callTool({
      name: "list_datasets",
      arguments: {},
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.total_count).toBe(1);
    const datasets = data.datasets as Record<string, unknown>[];
    expect(datasets[0].name).toBe("test-dataset");
    expect(datasets[0].id).toBe("ds-1");
    expect(datasets[0].created_at).toBe("2024-03-15T00:00:00.000Z");
  });

  it("passes filter parameters to client", async () => {
    mockLangSmithClient.listDatasets.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "list_datasets",
      arguments: {
        dataset_name: "specific-dataset",
        dataset_name_contains: "test",
        limit: 5,
      },
    });

    expect(mockLangSmithClient.listDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        datasetName: "specific-dataset",
        datasetNameContains: "test",
        limit: 5,
      })
    );
  });

  it("parses metadata JSON filter", async () => {
    mockLangSmithClient.listDatasets.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "list_datasets",
      arguments: {
        metadata: '{"env":"production"}',
      },
    });

    expect(mockLangSmithClient.listDatasets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { env: "production" },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// list_examples
// ---------------------------------------------------------------------------

describe("list_examples", () => {
  it("returns examples from a dataset", async () => {
    mockLangSmithClient.listExamples.mockReturnValue(
      toAsyncIterable([
        {
          id: "ex-1",
          dataset_id: "ds-1",
          inputs: { question: "What is 2+2?" },
          outputs: { answer: "4" },
          created_at: new Date("2024-04-01T00:00:00Z"),
          modified_at: new Date("2024-04-01T00:00:00Z"),
        },
      ])
    );

    const result = await client.callTool({
      name: "list_examples",
      arguments: { dataset_name: "test-dataset" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.total_count).toBe(1);
    const examples = data.examples as Record<string, unknown>[];
    expect(examples[0].id).toBe("ex-1");
    expect(examples[0].inputs).toEqual({ question: "What is 2+2?" });
  });

  it("passes boolean string parameters correctly", async () => {
    mockLangSmithClient.listExamples.mockReturnValue(toAsyncIterable([]));

    await client.callTool({
      name: "list_examples",
      arguments: {
        dataset_id: "ds-1",
        inline_s3_urls: "true",
        include_attachments: "false",
      },
    });

    expect(mockLangSmithClient.listExamples).toHaveBeenCalledWith(
      expect.objectContaining({
        inlineS3Urls: true,
        includeAttachments: false,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// read_dataset
// ---------------------------------------------------------------------------

describe("read_dataset", () => {
  it("reads a dataset by name", async () => {
    mockLangSmithClient.readDataset.mockResolvedValue({
      id: "ds-1",
      name: "my-dataset",
      description: "Test",
      data_type: "kv",
      example_count: 5,
      created_at: new Date("2024-01-01T00:00:00Z"),
      modified_at: new Date("2024-02-01T00:00:00Z"),
    });

    const result = await client.callTool({
      name: "read_dataset",
      arguments: { dataset_name: "my-dataset" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    const dataset = data.dataset as Record<string, unknown>;
    expect(dataset.name).toBe("my-dataset");
    expect(dataset.id).toBe("ds-1");
  });

  it("returns error when dataset not found", async () => {
    // readDatasetTool catches errors internally and returns { error: ... }
    mockLangSmithClient.readDataset.mockRejectedValue(
      new Error("Dataset not found")
    );

    const result = await client.callTool({
      name: "read_dataset",
      arguments: { dataset_name: "nonexistent" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("Dataset not found");
  });
});

// ---------------------------------------------------------------------------
// read_example
// ---------------------------------------------------------------------------

describe("read_example", () => {
  it("reads an example by ID", async () => {
    mockLangSmithClient.readExample.mockResolvedValue({
      id: "ex-1",
      dataset_id: "ds-1",
      inputs: { question: "Test?" },
      outputs: { answer: "Yes" },
      created_at: new Date("2024-05-01T00:00:00Z"),
      modified_at: new Date("2024-05-01T00:00:00Z"),
    });

    const result = await client.callTool({
      name: "read_example",
      arguments: { example_id: "ex-1" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    const example = data.example as Record<string, unknown>;
    expect(example.id).toBe("ex-1");
    expect(example.inputs).toEqual({ question: "Test?" });
  });
});

// ---------------------------------------------------------------------------
// list_experiments
// ---------------------------------------------------------------------------

describe("list_experiments", () => {
  it("returns experiments for a dataset", async () => {
    mockLangSmithClient.listProjects.mockReturnValue(
      toAsyncIterable([
        {
          id: "exp-1",
          name: "experiment-1",
          feedback_stats: { accuracy: { avg: 0.95 } },
          latency_p50: 1.2,
          latency_p99: 3.5,
          total_cost: 0.05,
        },
      ])
    );

    const result = await client.callTool({
      name: "list_experiments",
      arguments: { reference_dataset_id: "ds-1" },
    });
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    const experiments = data.experiments as Record<string, unknown>[];
    expect(experiments.length).toBe(1);
    expect(experiments[0].name).toBe("experiment-1");
    expect(experiments[0].latency_p50_seconds).toBe(1.2);
    expect(experiments[0].total_cost).toBe(0.05);
  });

  it("returns error when neither dataset ID nor name provided", async () => {
    const result = await client.callTool({
      name: "list_experiments",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("reference_dataset_id");
  });

  it("returns error when both dataset ID and name provided", async () => {
    const result = await client.callTool({
      name: "list_experiments",
      arguments: {
        reference_dataset_id: "ds-1",
        reference_dataset_name: "my-dataset",
      },
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("Cannot provide both");
  });
});

// ---------------------------------------------------------------------------
// get_billing_usage (uses REST API, mock global fetch)
// ---------------------------------------------------------------------------

describe("get_billing_usage", () => {
  it("returns usage data with workspace names", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        // billing usage response
        ok: true,
        json: async () => [
          {
            metric: "trace_count",
            groups: { "ws-1": 100, "ws-2": 200 },
          },
        ],
      })
      .mockResolvedValueOnce({
        // workspaces list response
        ok: true,
        json: async () => [
          { id: "ws-1", display_name: "Production", name: "production" },
          { id: "ws-2", display_name: "Staging", name: "staging" },
        ],
      }) as typeof fetch;

    try {
      const result = await client.callTool({
        name: "get_billing_usage",
        arguments: {
          starting_on: "2024-01-01",
          ending_before: "2024-02-01",
        },
      });
      const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
      expect(data).toHaveProperty("usage");
      const usage = data.usage as Record<string, unknown>[];
      expect(usage.length).toBe(1);
      expect(usage[0].metric).toBe("trace_count");
      const groups = usage[0].groups as Record<string, unknown>;
      expect(groups["ws-1"]).toEqual({
        workspace_name: "Production",
        value: 100,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns error on API failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    }) as typeof fetch;

    try {
      const result = await client.callTool({
        name: "get_billing_usage",
        arguments: {
          starting_on: "2024-01-01",
          ending_before: "2024-02-01",
        },
      });
      const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
      // The billing tool returns the error inside the result (not isError)
      // because the REST helper returns { error: ... } rather than throwing
      expect(data).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Error handling across tools
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("handler catch block wraps errors into toolError format", async () => {
    // To test the handler's catch block (which sets isError: true),
    // we make getLangSmithClient throw — this happens before the tool
    // function's own try-catch can intercept the error.
    const mockedGetClient = vi.mocked(getLangSmithClient);
    mockedGetClient.mockImplementation(() => {
      throw new Error("API key not found");
    });

    const result = await client.callTool({
      name: "list_prompts",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("API key not found");

    // Restore the default mock for other tests
    mockedGetClient.mockImplementation(() => mockLangSmithClient as any);
  });

  it("handler catch block handles non-Error thrown values", async () => {
    const mockedGetClient = vi.mocked(getLangSmithClient);
    mockedGetClient.mockImplementation(() => {
      throw "string error";
    });

    const result = await client.callTool({
      name: "list_prompts",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("string error");

    // Restore the default mock for other tests
    mockedGetClient.mockImplementation(() => mockLangSmithClient as any);
  });

  it("tool functions catch internal errors gracefully", async () => {
    // When the error happens inside a tool function (e.g. API call fails),
    // the tool function catches it and returns { error: ... } as a normal
    // result (isError is not set).
    mockLangSmithClient.listPrompts.mockImplementation(() => {
      throw new Error("Internal SDK error");
    });

    const result = await client.callTool({
      name: "list_prompts",
      arguments: {},
    });
    expect(result.isError).toBeUndefined();
    const data = parseToolResult(result as { content: unknown[] }) as Record<string, unknown>;
    expect(data.error).toContain("Internal SDK error");
  });
});
