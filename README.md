# LangSmith MCP Server (TypeScript)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-blue.svg)](https://nodejs.org/)

A TypeScript implementation of the [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) server for [LangSmith](https://smith.langchain.com). This is a full port of the official [Python LangSmith MCP Server](https://github.com/langchain-ai/langsmith-mcp-server) with 100% functional parity.

## Example Use Cases

The server enables powerful capabilities including:

- **Conversation History**: "Fetch the history of my conversation from thread 'thread-123' in project 'my-chatbot'" (paginated by character budget)
- **Prompt Management**: "Get all public prompts in my workspace" / "Pull the template for the 'legal-case-summarizer' prompt"
- **Traces & Runs**: "Fetch the latest 10 root runs from project 'alpha'" / "Get all runs for trace \<uuid\> (page 2 of 5)"
- **Datasets**: "List datasets of type chat" / "Read examples from dataset 'customer-support-qa'"
- **Experiments**: "List experiments for dataset 'my-eval-set' with latency and cost metrics"
- **Billing**: "Get billing usage for September 2025"

## Quick Start

```bash
LANGSMITH_API_KEY=your-key npx langsmith-mcp-server
```

## Available Tools

The LangSmith MCP Server provides the following tools for integration with LangSmith.

### Conversation & Threads

| Tool Name | Description |
|-----------|-------------|
| `get_thread_history` | Retrieve message history for a conversation thread. Uses **char-based pagination**: pass `page_number` (1-based), and use returned `total_pages` to request more pages. Optional `max_chars_per_page` and `preview_chars` control page size and long-string truncation. |

### Prompt Management

| Tool Name | Description |
|-----------|-------------|
| `list_prompts` | Fetch prompts from LangSmith with optional filtering by visibility (public/private) and limit. |
| `get_prompt_by_name` | Get a specific prompt by its exact name, returning the prompt details and template. |
| `push_prompt` | Documentation-only: how to create and push prompts to LangSmith. |

### Traces & Runs

| Tool Name | Description |
|-----------|-------------|
| `fetch_runs` | Fetch LangSmith runs (traces, tools, chains, etc.) from one or more projects. Supports filters (run_type, error, is_root), FQL (`filter`, `trace_filter`, `tree_filter`), and ordering. All results are **automatically paginated** by character budget. Always pass `limit` and `page_number`. |
| `list_projects` | List LangSmith projects with optional filtering by name, dataset, and detail level (simplified vs full). |

### Datasets & Examples

| Tool Name | Description |
|-----------|-------------|
| `list_datasets` | Fetch datasets with filtering by ID, type, name, name substring, or metadata. |
| `list_examples` | Fetch examples from a dataset by dataset ID/name or example IDs, with filter, metadata, splits, and optional `as_of` version. |
| `read_dataset` | Read a single dataset by ID or name. |
| `read_example` | Read a single example by ID, with optional `as_of` version. |
| `create_dataset` | Documentation-only: how to create datasets in LangSmith. |
| `update_examples` | Documentation-only: how to update dataset examples in LangSmith. |

### Experiments & Evaluations

| Tool Name | Description |
|-----------|-------------|
| `list_experiments` | List experiment projects (reference projects) for a dataset. Requires `reference_dataset_id` or `reference_dataset_name`. Returns key metrics (latency, cost, feedback stats). |
| `run_experiment` | Documentation-only: how to run experiments and evaluations in LangSmith. |

### Usage & Billing

| Tool Name | Description |
|-----------|-------------|
| `get_billing_usage` | Fetch organization billing usage (e.g. trace counts) for a date range. Optional workspace filter; returns metrics with workspace names inline. |

### Pagination (char-based)

Several tools use **stateless, character-budget pagination** so responses stay within a size limit and work well with LLM clients:

- **Where it's used:** `get_thread_history` and `fetch_runs`.
- **Parameters:** You send `page_number` (1-based) on every request. Optional: `max_chars_per_page` (default 25000, cap 30000) and `preview_chars` (truncate long strings with "... (+N chars)").
- **Response:** Each response includes `page_number`, `total_pages`, and the page payload (`result` for messages, `runs` for runs). To get more, call again with `page_number = 2`, then `3`, up to `total_pages`.
- **Why it's useful:** Pages are built by JSON character count, not item count, so each page fits within a fixed size. No cursor or server-side state -- just integer page numbers.

## Installation

### From npm

```bash
npx langsmith-mcp-server
```

### MCP Client Integration

#### Cursor / Claude Code

Add to your MCP settings:

```json
{
  "mcpServers": {
    "langsmith": {
      "command": "npx",
      "args": ["langsmith-mcp-server"],
      "env": {
        "LANGSMITH_API_KEY": "your-key"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `LANGSMITH_API_KEY` | Yes | Your LangSmith API key for authentication | `lsv2_pt_1234567890` |
| `LANGSMITH_WORKSPACE_ID` | No | Workspace ID for API keys scoped to multiple workspaces | `your_workspace_id` |
| `LANGSMITH_ENDPOINT` | No | Custom API endpoint URL (for self-hosted or EU region) | `https://eu.api.smith.langchain.com` |

**Notes:**
- Only `LANGSMITH_API_KEY` is required for basic functionality
- `LANGSMITH_WORKSPACE_ID` is useful when your API key has access to multiple workspaces
- `LANGSMITH_ENDPOINT` allows you to use custom endpoints for self-hosted LangSmith installations or the EU region

## Development and Contributing

### Setup

```bash
# Clone the repository
git clone https://github.com/langchain-ai/langsmith-mcp-server-js.git
cd langsmith-mcp-server-js

# Install dependencies
npm install

# Build
npm run build

# Run in development mode
LANGSMITH_API_KEY=your-key npm run dev

# Run production build
LANGSMITH_API_KEY=your-key npm start
```

### Testing

```bash
# Run unit tests
npm test
```

### MCP Inspector

For interactive development and debugging, use the MCP Inspector:

```bash
LANGSMITH_API_KEY=your-key npx @modelcontextprotocol/inspector npx .
```

This opens a browser UI where you can browse all tools, inspect their schemas, and invoke them interactively.

### Verify the server responds

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | LANGSMITH_API_KEY=test npx . 2>/dev/null
```

### Architecture

This is a direct port of the [Python LangSmith MCP Server](https://github.com/langchain-ai/langsmith-mcp-server) with the same module structure:

```
src/
  index.ts                    # Entry point (stdio transport)
  server.ts                   # McpServer setup
  common/
    helpers.ts                # Client creation, data conversion utilities
    pagination.ts             # Char-based stateless pagination
    formatters.ts             # Message extraction and formatting
  services/
    register-tools.ts         # MCP tool registration with Zod schemas
    tools/
      prompts.ts              # Prompt management tools
      traces.ts               # Trace/run/project tools
      datasets.ts             # Dataset and example tools
      experiments.ts          # Experiment listing tools
      usage.ts                # Billing/usage REST API tools
```

## Contributing

This TypeScript implementation is a community port of the official [Python LangSmith MCP Server](https://github.com/langchain-ai/langsmith-mcp-server) by [LangChain](https://langchain.com).

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

This project is distributed under the MIT License. For detailed terms and conditions, please refer to the [LICENSE](LICENSE) file.
