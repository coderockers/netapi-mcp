/**
 * NetAPI MCP server over stdio, for running it locally with Node (and for MCP directories that build and start
 * servers in a container). The same tools as the Worker; every tool call is one GET to the NetAPI JSON API.
 *
 *   npm install && npm run stdio
 *
 * Environment (both optional):
 *   NETAPI_API_TOKEN  a NetAPI API token: adds the account / plan tools and the higher limits of the account;
 *                     without it the free tools are offered with anonymous limits (like /mcp/public)
 *   NETAPI_JSON_API   the JSON API base URL, default https://netapi.com/api-json/
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// read through globalThis: the project's type set is the Workers one, which does not declare Node's process
const nodeEnv = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {});

const token = nodeEnv.NETAPI_API_TOKEN?.trim() || null;
const server = createServer({
  env: {
    NETAPI_JSON_API: nodeEnv.NETAPI_JSON_API?.trim() || 'https://netapi.com/api-json/',
    NETAPI_SITE: 'https://netapi.com'
  },
  token,
  clientIp: null
});

await server.connect(new StdioServerTransport());
