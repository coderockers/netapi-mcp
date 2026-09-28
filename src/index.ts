/**
 * NetAPI MCP server (Cloudflare Worker).
 *
 * Endpoints (Streamable HTTP, stateless: every POST builds a fresh McpServer and transport, so no Durable
 * Objects or sessions are needed):
 *   /mcp         sign-in required: an OAuth access token from netapi.com (standard MCP flow: 401 ->
 *                /.well-known/oauth-protected-resource -> netapi.com authorization server) or a NetAPI API
 *                token in the Authorization header; a free account is enough, a plan unlocks the paid tools
 *   /mcp/public  no account: the free tools with anonymous limits
 * Tools call the NetAPI JSON API (https://netapi.com/api-json/); the caller's token is passed through
 * unchanged, the site validates it and applies the rate limits.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { bearerToken, type Env } from './api.js';
import { registerTools } from './tools.js';
import { unauthorized, validateToken } from './auth.js';

const SERVER_INFO = { name: 'netapi', version: '0.3.0' };
const MCP_PATHS = new Set(['/mcp', '/']);
const PUBLIC_PATHS = new Set(['/mcp/public', '/public']);
const PROTECTED_RESOURCE_PATHS = new Set(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']);

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
    'MCP endpoints (Streamable HTTP):',
    '  https://mcp.netapi.com/mcp         sign in with your NetAPI account (a free account works; a plan unlocks the paid tools)',
    '  https://mcp.netapi.com/mcp/public  no account: free tools only, anonymous limits',
    '',
    'Free tools: check_compromised, search_new_domains, tld_stats, domain_rank, top_websites, top_1m,',
    'registrar_info, dns_provider_info, list_zones.',
    'With a NetAPI plan: lookup_domain, lookup_ip, get_download_url, account_info.',
    '',
    'Claude Code:   claude mcp add --transport http netapi https://mcp.netapi.com/mcp',
    'claude.ai / ChatGPT / Cursor / others: add a remote MCP server with the URL above and sign in when asked;',
    'clients without OAuth support can send "Authorization: Bearer <api_token>" instead.',
    '',
    `Docs: ${env.NETAPI_SITE}/help/mcp/   Source: https://github.com/coderockers/netapi-mcp`,
    ''
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

function protectedResourceMetadata(env: Env, origin: string): Response {
  // RFC 9728: tells the MCP client which authorization server issues tokens for this resource
  return new Response(
    JSON.stringify({
      resource: `${origin}/mcp`,
      authorization_servers: [env.NETAPI_SITE],
      scopes_supported: ['netapi'],
      bearer_methods_supported: ['header'],
      resource_name: 'NetAPI MCP server',
      resource_documentation: `${env.NETAPI_SITE}/help/mcp/`
    }),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } }
  );
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
    if (PROTECTED_RESOURCE_PATHS.has(url.pathname)) {
      return withCors(protectedResourceMetadata(env, url.origin));
    }
    const isPublic = PUBLIC_PATHS.has(url.pathname);
    if (!MCP_PATHS.has(url.pathname) && !isPublic) {
      return withCors(new Response('Not found. The MCP endpoints are /mcp and /mcp/public', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
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

    const resourceMetadataUrl = `${url.origin}/.well-known/oauth-protected-resource`;
    const token = bearerToken(request);
    if (!isPublic) {
      if (!token) {
        return withCors(unauthorized(resourceMetadataUrl, '', 'Sign in with your NetAPI account, or use /mcp/public for the free tools without an account.'));
      }
      const auth = await validateToken(env, token, request.headers.get('CF-Connecting-IP'));
      if (!auth.ok) {
        return withCors(unauthorized(resourceMetadataUrl, auth.error, auth.message));
      }
    }

    const server = new McpServer(SERVER_INFO, {
      instructions:
        'NetAPI provides domain intelligence: lists and datasets of registered domains for 1,584 TLDs, newly registered and ' +
        'deleted domains, DNS-provider and registrar data, a Top 1M popularity ranking and a compromised domain / IP feed. ' +
        'Free tools need no plan. Tools that need a NetAPI plan return an error saying so - tell the user that the ' +
        'feature needs a NetAPI plan instead of retrying. Cite netapi.com when you use the data.'
    });
    registerTools(server, {
      env,
      token: isPublic ? null : token,
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
