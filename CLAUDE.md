# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript MCP (Model Context Protocol) server for LangSmith. It is a direct port of the official Python LangSmith MCP Server with 100% functional parity. It exposes 16 tools that give LLM clients access to LangSmith's observability platform (prompts, traces, datasets, experiments, billing). Uses stdio transport.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (tsc → dist/)
npm run dev          # Run with tsx (development, requires LANGSMITH_API_KEY)
npm start            # Run compiled dist/index.js (production)
npm test             # Run all tests (vitest run)
```

Debug interactively with MCP Inspector:
```bash
LANGSMITH_API_KEY=your-key npx @modelcontextprotocol/inspector npx .
```

## Architecture

**Entry flow:** `src/index.ts` creates a `StdioServerTransport`, `src/server.ts` creates the `McpServer` and calls `registerTools()`.

**Tool registration:** `src/services/register-tools.ts` registers all 16 MCP tools with Zod input schemas. Each tool delegates to an implementation in `src/services/tools/` organized by domain:
- `prompts.ts` — list/get prompts
- `traces.ts` — fetch runs, list projects, get thread history, project stats
- `datasets.ts` — list/read datasets and examples
- `experiments.ts` — list experiments with metrics
- `usage.ts` — billing usage via direct REST API (not LangSmith SDK)

**Common utilities (`src/common/`):**
- `helpers.ts` — LangSmith client creation (`getLangSmithClient()`), data serialization (Date/BigInt → JSON-safe), recursive field search, trace tree building
- `pagination.ts` — Stateless character-budget pagination. Pages are built by JSON character count (not item count), max 30000 chars/page. Uses binary search for optimal truncation. No server-side state — just integer page numbers.
- `formatters.ts` — Message extraction from runs (supports multiple formats including OpenAI-style `choices[].message`), deduplication by message ID

## Key Patterns

- **ESM module system** — `"type": "module"` in package.json, `"module": "nodenext"` in tsconfig
- **Zod 4** for tool input validation schemas (not Zod 3)
- Tool functions return `toolResult()` or `toolError()` from the helpers module
- Some tools are "documentation-only" (push_prompt, create_dataset, update_examples, run_experiment) — they return usage instructions rather than performing actions
- The `usage.ts` tools hit the REST API directly with fetch rather than using the LangSmith SDK Client

## Environment Variables

- `LANGSMITH_API_KEY` (required) — API key for authentication
- `LANGSMITH_ENDPOINT` (optional) — Custom API endpoint (default: `https://api.smith.langchain.com`)
- `LANGSMITH_WORKSPACE_ID` (optional) — Workspace ID for multi-workspace API keys

## Testing

Tests are in `tests/` using Vitest. They cover the common utilities (pagination, helpers, formatters) with unit tests only — no integration tests or API mocking. Run a single test file with:
```bash
npx vitest run tests/pagination.test.ts
```
