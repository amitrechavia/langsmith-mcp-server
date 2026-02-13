#!/usr/bin/env node

/**
 * LangSmith MCP Server - TypeScript implementation.
 *
 * Entry point that creates the MCP server and connects it to stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LangSmith MCP server running on stdio");
}

main().catch((error) => {
  console.error("Failed to start LangSmith MCP server:", error);
  process.exit(1);
});
