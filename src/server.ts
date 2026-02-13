/**
 * MCP server for LangSmith SDK integration.
 * This server exposes methods to interact with LangSmith's observability platform:
 * - get_thread_history: Fetch conversation history for a specific thread
 * - get_prompts: Fetch prompts from LangSmith with optional filtering
 * - pull_prompt: Pull a specific prompt by its name
 * - fetch_runs: Fetch runs with flexible filters
 * - list_projects: List LangSmith projects
 * - list_datasets: Fetch datasets
 * - list_examples: Fetch examples from datasets
 * - list_experiments: List experiment projects
 * - get_billing_usage: Fetch billing usage data
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./services/register-tools.js";

// Create MCP server
export const server = new McpServer(
  { name: "LangSmith API MCP Server", version: "0.1.0" },
  { capabilities: { logging: {} } }
);

// Register all tools with the server
registerTools(server);
