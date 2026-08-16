#!/usr/bin/env node
/**
 * Memory MCP Server — stdio entry point.
 *
 *   node dist/index.js
 *
 * The workspace can be fixed for the whole server process via the
 * AGENT_MEMORY_WORKSPACE environment variable (recommended when configuring
 * per-project MCP servers), or passed per-call via each tool's
 * `workspacePath` argument.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process must stay alive while the transport is open. Logging goes to
  // stderr — stdout is reserved for the MCP protocol.
  console.error('[memory-mcp] server running on stdio');
}

main().catch((err) => {
  console.error('[memory-mcp] fatal error:', err);
  process.exit(1);
});
