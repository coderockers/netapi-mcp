/**
 * Thin client for the NetAPI JSON API (https://netapi.com/api-json/).
 * Every MCP tool call becomes one GET request here; the caller's Bearer token (if any) is passed through,
 * so the site decides what the caller may do and applies its rate limits.
 */

export interface Env {
  NETAPI_JSON_API: string;
  NETAPI_SITE: string;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export type Params = Record<string, string | number | boolean | undefined | null>;

export async function callApi(env: Env, method: string, params: Params, token: string | null, clientIp: string | null): Promise<ApiResult> {
  const url = new URL(env.NETAPI_JSON_API);
  url.searchParams.set('method', method);
  url.searchParams.set('source', 'mcp');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'netapi-mcp/0.1 (+https://mcp.netapi.com)'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (clientIp) {
    // informational; the site keys anonymous limits on CF-Connecting-IP, which Cloudflare preserves for
    // subrequests to a zone of the same account
    headers['X-MCP-Client-IP'] = clientIp;
  }

  const response = await fetch(url.toString(), { headers, cf: { cacheTtl: 0 } } as RequestInit);
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { code: 'bad_response', message: `Unexpected answer from the API (HTTP ${response.status}).`, body: text.slice(0, 300) } };
  }
  return { ok: response.ok, status: response.status, data };
}

/**
 * Bearer token of the incoming MCP request, or null.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}
