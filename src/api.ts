/**
 * Thin client for the NetAPI JSON API (https://netapi.com/api-json/).
 * Every MCP tool call becomes one GET request here; the caller's Bearer token (if any) is passed through,
 * so the site decides what the caller may do and applies its rate limits.
 */

export interface Env {
  NETAPI_JSON_API: string;
  NETAPI_SITE: string;
  /** Worker secret (dashboard > Settings > Variables and secrets); must equal cfg.php system.mcp_secret on the site */
  NETAPI_MCP_SECRET?: string;
  /** Domain-verification token of the ChatGPT app-directory submission (public by design, wrangler.toml [vars]) */
  OPENAI_APPS_CHALLENGE?: string;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export type Params = Record<string, string | number | boolean | undefined | null>;

export const USER_AGENT = 'netapi-mcp/0.3 (+https://mcp.netapi.com)';
/** a tool call waits this long for the site before it fails with a bad_response error */
const API_TIMEOUT_MS = 30_000;

/**
 * Headers of a request to the site: the caller's token, and the real client IP with the shared secret (the site
 * sees the Worker's egress IP otherwise; it trusts the forwarded IP only when the secret matches).
 */
export function apiHeaders(env: Env, token: string | null, clientIp: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': USER_AGENT
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (clientIp && env.NETAPI_MCP_SECRET) {
    headers['X-MCP-Client-IP'] = clientIp;
    headers['X-NetAPI-MCP-Secret'] = env.NETAPI_MCP_SECRET;
  }
  return headers;
}

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

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: apiHeaders(env, token, clientIp), signal: AbortSignal.timeout(API_TIMEOUT_MS), cf: { cacheTtl: 0 } } as RequestInit);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 503, data: { error: { code: 'unavailable', message: `NetAPI did not answer (${reason}). Try again in a moment.` } } };
  }
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
