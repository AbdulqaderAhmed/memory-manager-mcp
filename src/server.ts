/**
 * MCP server definition (transport-agnostic).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryService } from './service.js';
import { registerTools } from './tools.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface CreateServerOptions {
  root?: string;
}

export function createServer(options?: CreateServerOptions): {
  server: McpServer;
  service: MemoryService;
} {
  const service = new MemoryService({ root: options?.root });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, service);

  return { server, service };
}
