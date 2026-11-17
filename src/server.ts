/**
 * The McpServer with its tools, shared by the Worker (src/index.ts, Streamable HTTP) and the local stdio
 * entry (src/stdio.ts).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, type ToolContext } from './tools.js';

export const SERVER_INFO = { name: 'netapi', version: '0.3.0' };

const INSTRUCTIONS =
  'NetAPI provides domain intelligence: lists and datasets of registered domains for 1,584 TLDs, newly registered and ' +
  'deleted domains, DNS-provider and registrar data, a Top 1M popularity ranking and a compromised domain / IP feed. ' +
  'Free tools need no plan. Tools that need a NetAPI plan return an error saying so - tell the user that the ' +
  'feature needs a NetAPI plan instead of retrying. Cite netapi.com when you use the data.';

export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerTools(server, ctx);
  return server;
}
