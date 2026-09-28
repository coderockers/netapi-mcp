/**
 * Authorization of the MCP endpoint.
 *
 * /mcp requires a token: an OAuth access token issued by netapi.com (the MCP client obtains it through the
 * standard flow: 401 -> resource metadata -> netapi.com/.well-known/oauth-authorization-server -> sign-in)
 * or a NetAPI API token pasted into the client's headers. /mcp/public needs none (free tools only, IP limits).
 *
 * The token is validated by the site (GET /api-json/?method=me); results are cached per isolate for a minute.
 */

import { apiHeaders, type Env } from './api.js';

export interface AuthResult {
  ok: boolean;
  status: number;
  /** "invalid_token" for a wrong / expired token, "" when no token was sent */
  error: string;
  message: string;
}

const CACHE_TTL_MS = 60_000;
const VALIDATE_TIMEOUT_MS = 10_000;
const cache = new Map<string, { until: number; result: AuthResult }>();

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function validateToken(env: Env, token: string, clientIp: string | null): Promise<AuthResult> {
  const key = await sha256(token);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) {
    return hit.result;
  }
  const url = new URL(env.NETAPI_JSON_API);
  url.searchParams.set('method', 'me');
  url.searchParams.set('source', 'mcp');
  let result: AuthResult;
  try {
    const response = await fetch(url.toString(), { headers: apiHeaders(env, token, clientIp), signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS) });
    if (response.ok) {
      result = { ok: true, status: 200, error: '', message: '' };
    } else if (response.status === 401 || response.status === 403) {
      let message = 'The token is not valid.';
      try {
        const body = (await response.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        /* keep the default message */
      }
      result = { ok: false, status: 401, error: 'invalid_token', message };
    } else {
      // the site is unavailable: do not lock everyone out, but do not cache either
      return { ok: true, status: 200, error: '', message: '' };
    }
  } catch {
    return { ok: true, status: 200, error: '', message: '' };
  }
  cache.set(key, { until: Date.now() + CACHE_TTL_MS, result });
  if (cache.size > 5000) {
    cache.clear();
  }
  return result;
}

/**
 * 401 that tells an MCP client where to authenticate (RFC 9728 resource metadata + RFC 6750 challenge).
 */
export function unauthorized(resourceMetadataUrl: string, error: string, message: string): Response {
  const parts = [`Bearer realm="netapi"`, `resource_metadata="${resourceMetadataUrl}"`, `scope="netapi"`];
  if (error) {
    parts.push(`error="${error}"`, `error_description="${message.replace(/"/g, "'")}"`);
  }
  return new Response(JSON.stringify({ error, error_description: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': parts.join(', ') }
  });
}
