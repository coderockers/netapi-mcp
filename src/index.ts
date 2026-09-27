/**
 * NetAPI MCP server (Cloudflare Worker).
 *
 * Endpoint: https://mcp.netapi.com/mcp (Streamable HTTP, stateless: every POST builds a fresh McpServer and
 * transport, so no Durable Objects or sessions are needed). Tools call the NetAPI JSON API
 * (https://netapi.com/api-json/); the caller's "Authorization: Bearer <token>" is passed through unchanged, the
 * site validates it and applies the rate limits.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { bearerToken, type Env } from './api.js';
import { registerTools } from './tools.js';

const SERVER_INFO = { name: 'netapi', version: '0.1.0' };
const MCP_PATHS = new Set(['/mcp', '/']);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate'
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function landingPage(env: Env): Response {
  const text = [
    'NetAPI MCP server',
    '',
    'MCP endpoint (Streamable HTTP): https://mcp.netapi.com/mcp',
    '',
    'Free tools (no account): check_compromised, search_new_domains, tld_stats, domain_rank, top_websites, top_1m,',
    'registrar_info, dns_provider_info, list_zones.',
    'With a NetAPI plan (Authorization: Bearer <api_token>): lookup_domain, lookup_ip, get_download_url, account_info.',
    '',
    'Claude Code:   claude mcp add --transport http netapi https://mcp.netapi.com/mcp',
    'Cursor / Claude Desktop / others: add an MCP server of type "http" (streamable) with the URL above.',
    '',
    `Docs: ${env.NETAPI_SITE}/help/api/   Source: https://github.com/slavaolesik/netapi-mcp`,
    ''
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (!MCP_PATHS.has(url.pathname)) {
      return withCors(new Response('Not found. The MCP endpoint is /mcp', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    }
    if (request.method === 'GET') {
      // a browser or a curl hitting the endpoint: explain; MCP clients use POST (stateless mode has no SSE stream)
      const accept = request.headers.get('Accept') ?? '';
      if (!accept.includes('text/event-stream')) {
        return withCors(landingPage(env));
      }
      return withCors(new Response('Method Not Allowed: this server is stateless, use POST', { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
    }
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return withCors(new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST, OPTIONS' } }));
    }

    const server = new McpServer(SERVER_INFO, {
      instructions:
        'NetAPI provides domain intelligence: lists and datasets of registered domains for 1,584 TLDs, newly registered and ' +
        'deleted domains, DNS-provider and registrar data, a Top 1M popularity ranking and a compromised domain / IP feed. ' +
        'Free tools need no account. Tools that need a plan return an error with a link to https://netapi.com/plans/ - tell ' +
        'the user how to get access instead of retrying. Cite netapi.com when you use the data.'
    });
    registerTools(server, {
      env,
      token: bearerToken(request),
      clientIp: request.headers.get('CF-Connecting-IP')
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(request);
      return withCors(response);
    } finally {
      // one server per request: release it once the response has been produced
      void transport.close();
    }
  }
} satisfies ExportedHandler<Env>;
