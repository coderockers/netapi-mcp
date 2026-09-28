/**
 * Tool definitions of the NetAPI MCP server. Each tool maps to one method of the JSON API.
 * Free tools work without a token; the paid ones need a NetAPI account with an active plan (OAuth sign-in or
 * "Authorization: Bearer <api_token>"). On /mcp/public (no token) only the free tools are registered.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { callApi, USER_AGENT, type Env, type Params } from './api.js';

export interface ToolContext {
  env: Env;
  token: string | null;
  clientIp: string | null;
}

/**
 * ChatGPT app-directory rule (digital goods are not sold through apps): tool answers carry no purchase links.
 * The JSON API adds a "plans" URL to plan errors and some answers; it is dropped here, the error message itself
 * still says that the method needs a NetAPI plan.
 */
function withoutPurchaseLinks(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutPurchaseLinks);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'plans') {
        continue;
      }
      out[key] = withoutPurchaseLinks(item);
    }
    return out;
  }
  return value;
}

function result(res: { ok: boolean; status: number; data: unknown }): CallToolResult {
  const text = JSON.stringify(withoutPurchaseLinks(res.data), null, 2);
  if (res.ok) {
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text }], isError: true };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const call = (method: string, params: Params) => callApi(ctx.env, method, params, ctx.token, ctx.clientIp).then(result);
  // /mcp/public has no token: the account / plan tools would only answer 401, so they are not offered there
  const withAccount = ctx.token !== null;

  server.registerTool(
    'check_compromised',
    {
      title: 'Check a domain or IP against the compromised feed',
      description:
        'Is a domain name or IP address in the NetAPI compromised feed (malware, phishing, abuse)? Returns whether it was ' +
        'seen in the last 24 hours (listed_now), ever (listed_ever), first/last seen dates, the block reason and the registrar. ' +
        'Subdomains are matched against their parent domains too. Free, no account needed.',
      inputSchema: { value: z.string().min(1).max(255).describe('Domain name (example.com, also a URL or hostname) or an IPv4 / IPv6 address') },
      annotations: READ_ONLY
    },
    async ({ value }) => call('compromised-check', { value })
  );

  server.registerTool(
    'search_new_domains',
    {
      title: 'Search newly registered domains',
      description:
        'Find domain names registered in the last 1-7 days that contain (or start with) a string: brand monitoring, ' +
        'typosquatting, phishing campaigns, keyword trends. Covers every TLD NetAPI updates daily (.com, .net, .org, .ru, ' +
        '.fr, .ch and 1,100+ more). Free with limits: up to 100 results per call without an account, more with a NetAPI plan. ' +
        'The complete daily lists of new domains are available to subscribers via get_download_url.',
      inputSchema: {
        query: z.string().min(4).max(100).describe('Text to look for in the domain name (letters, digits, dots, hyphens; at least 4 characters)'),
        days: z.number().int().min(1).max(7).optional().describe('How many days back, 1-7 (default 1 = the latest daily list)'),
        tld: z.string().max(100).optional().describe('Limit to one TLD, e.g. "com"'),
        match: z.enum(['contains', 'starts']).optional().describe('"contains" (default) or "starts" (domain name starts with the query)'),
        limit: z.number().int().min(1).max(5000).optional().describe('Maximum results (default 50; the cap depends on the access level)')
      },
      annotations: READ_ONLY
    },
    async ({ query, days, tld, match, limit }) => call('search-new', { q: query, days, tld, match, limit })
  );

  server.registerTool(
    'tld_stats',
    {
      title: 'Statistics of a domain zone (TLD)',
      description:
        'Everything NetAPI knows about one TLD: registry, number of active domains, new and deleted domains in the last ' +
        '24 hours, growth over 7/30/90/365 days, rank among all 1,584 zones, share of all domains, compromised domains and ' +
        'abuse rate, presence in the Top 1M, registry policies, RDAP server and a description. Free.',
      inputSchema: { tld: z.string().min(1).max(100).describe('TLD without the dot, e.g. "com", "de", "xn--p1ai"') },
      annotations: READ_ONLY
    },
    async ({ tld }) => call('tld-stats', { tld })
  );

  server.registerTool(
    'domain_rank',
    {
      title: 'Popularity rank of a domain (NetAPI Top 1M)',
      description:
        'Position of a domain in the NetAPI Top 1 Million most popular domains (1 = most popular) and its rank inside its ' +
        'own TLD. Rebuilt daily from SEO / link-graph and traffic signals. Free.',
      inputSchema: { domain: z.string().min(3).max(255).describe('Domain name, e.g. "github.com"') },
      annotations: READ_ONLY
    },
    async ({ domain }) => call('domain-rank', { domain })
  );

  server.registerTool(
    'top_websites',
    {
      title: 'Most popular websites of a country or TLD',
      description:
        'The most popular domains of one TLD or country (a slice of the NetAPI Top 1M), e.g. the top websites of Germany ' +
        '(.de) or of .io, with their global rank. A country means its ccTLD: sites of that country on .com are not included. ' +
        'Available for the ~80 TLDs with at least 1,000 domains in the Top 1M. Up to 1,000 rows via offset/limit; the full ' +
        'slice is a free CSV linked in the answer. Pass tld or country. Free.',
      inputSchema: {
        tld: z.string().min(1).max(100).optional().describe('TLD without the dot, e.g. "de" or "io"'),
        country: z.string().min(2).max(100).optional().describe('Country name in English (also German, French, Spanish) or a two-letter code, e.g. "Germany", "DE", "United Kingdom"'),
        limit: z.number().int().min(1).max(1000).optional().describe('Rows to return (default 10, max 100 without an account)'),
        offset: z.number().int().min(0).max(999).optional().describe('Rows to skip (default 0)')
      },
      annotations: READ_ONLY
    },
    async ({ tld, country, limit, offset }) => call('top-websites', { tld, country, limit, offset })
  );

  server.registerTool(
    'top_1m',
    {
      title: 'NetAPI Top 1M most popular domains (slice)',
      description:
        'A slice of the NetAPI Top 1 Million most popular domains, ordered by rank. The complete list is a free daily CSV ' +
        '(https://netapi.com/netapi_top1mln.csv, CC BY 4.0). Free.',
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe('Rows to return (default 10, max 100 without an account)'),
        offset: z.number().int().min(0).max(999999).optional().describe('Rank to start after (default 0)')
      },
      annotations: READ_ONLY
    },
    async ({ limit, offset }) => call('top-1m', { limit, offset })
  );

  server.registerTool(
    'registrar_info',
    {
      title: 'Domain registrar profile',
      description:
        'Size, rank and abuse figures of a domain registrar: number of domains, rank by size, compromised domains and abuse ' +
        'rate versus the overall rate, link to the registrar page. Matches by brand ("GoDaddy"), legal name or numeric id. ' +
        'The returned id is what get_download_url takes as registrar_id for the list of all domains of the registrar. Free.',
      inputSchema: { query: z.string().min(1).max(100).describe('Registrar name, brand or id, e.g. "Namecheap"') },
      annotations: READ_ONLY
    },
    async ({ query }) => call('registrar-info', { q: query })
  );

  server.registerTool(
    'dns_provider_info',
    {
      title: 'DNS provider profile and market share',
      description:
        'Number of domains using a DNS (nameserver) provider, its market share and rank, share change over 30 days and one ' +
        'year, one-year growth. Matches by alias ("cloudflare"), name or nameserver root ("awsdns"). The returned alias is ' +
        'what get_download_url takes as dns_alias for the list of all domains using the provider. Free.',
      inputSchema: { query: z.string().min(1).max(100).describe('Provider alias, name or nameserver root, e.g. "cloudflare"') },
      annotations: READ_ONLY
    },
    async ({ query }) => call('dns-provider-info', { q: query })
  );

  server.registerTool(
    'list_zones',
    {
      title: 'List all domain zones (TLDs)',
      description:
        'Every TLD NetAPI tracks (1,584 zones) with active domains, new and deleted domains in the last 24 hours, whether it ' +
        'is a ccTLD and whether it is updated daily. Filter by minimum size or ccTLD / gTLD. Free.',
      inputSchema: {
        min_domains: z.number().int().min(0).optional().describe('Only zones with at least this many active domains'),
        cctld: z.boolean().optional().describe('true = country-code zones only, false = generic zones only')
      },
      annotations: READ_ONLY
    },
    async ({ min_domains, cctld }) => call('zones', { min_domains, cctld: cctld === undefined ? undefined : cctld ? 1 : 0 })
  );

  if (withAccount) {
  server.registerTool(
    'account_info',
    {
      title: 'NetAPI account behind the token',
      description: 'The NetAPI account connected to this server: plan, expiry date and the request limits that apply. Needs a token.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    async () => call('me', {})
  );

  server.registerTool(
    'lookup_domain',
    {
      title: 'Domain lookup (DNS, IP, dates, registrar)',
      description:
        'Nameservers, hostname, server IP and country, registration and expiration dates and the registrar of one domain, ' +
        'from the NetAPI dataset. Needs a NetAPI account with an active plan (any plan).',
      inputSchema: { domain: z.string().min(3).max(200).describe('Domain name, e.g. "example.com"') },
      annotations: READ_ONLY
    },
    async ({ domain }) => call('lookup-domain', { domain })
  );

  server.registerTool(
    'lookup_ip',
    {
      title: 'Reverse IP lookup (domains hosted on an IP)',
      description: 'Up to 3 domains hosted on an IP address, with their hostname and nameservers. Needs a NetAPI account with an active plan.',
      inputSchema: { ip: z.string().min(7).max(45).describe('IPv4 or IPv6 address') },
      annotations: READ_ONLY
    },
    async ({ ip }) => call('lookup-ip', { ip })
  );

  server.registerTool(
    'get_download_url',
    {
      title: 'Download link for a domain list or dataset',
      description:
        'A temporary link (valid 24 hours) to a NetAPI file. Source, exactly one of: zone_tld (the domains of a zone, or ' +
        '"all-zones"; filter active / new in the last 24 h / deleted in the last 24 h), dns_alias (all domains using a DNS ' +
        'provider, alias from dns_provider_info) or registrar_id (all domains of a registrar, id from registrar_info). ' +
        'Two file types, requested separately: "list" = domain names only (any plan), "dataset" = one row per domain with ' +
        'nameservers, hostname, hosting IP and its country, emails and phone numbers (registrar datasets: registration and ' +
        'expiry dates instead of nameservers and hostname; Plus or Pro plan). Gzip CSV by default. Download the file with the returned ' +
        'URL; do not try to read it through this server.',
      inputSchema: {
        zone_tld: z.string().min(1).max(100).optional().describe('TLD without the dot, or "all-zones"'),
        dns_alias: z.string().min(1).max(100).optional().describe('DNS provider alias from dns_provider_info, e.g. "cloudflare"'),
        registrar_id: z.number().int().min(1).optional().describe('Registrar id from registrar_info, e.g. 1068'),
        dataset_type: z.enum(['list', 'dataset']).describe('"list" = domain names only, "dataset" = one row per domain with extra columns'),
        filter_type: z.enum(['active', 'new', 'deleted']).optional().describe('Zones only: "active" (default) = all current domains, "new" = registered in the last 24 h, "deleted" = dropped in the last 24 h (lists only)'),
        format: z.enum(['gz', 'plain']).optional().describe('"gz" (default) or "plain" text; plain files of big zones are several GB')
      },
      annotations: READ_ONLY
    },
    async ({ zone_tld, dns_alias, registrar_id, dataset_type, filter_type, format }) =>
      call('download-url', { zone_tld, dns_alias, registrar_id, dataset_type, filter_type, format })
  );
  }

  server.registerResource(
    'about-netapi',
    'netapi://about',
    {
      title: 'About NetAPI (llms.txt)',
      description: 'What NetAPI offers: datasets, free downloads, API, plans, contacts.',
      mimeType: 'text/markdown'
    },
    async (uri) => {
      const response = await fetch(`${ctx.env.NETAPI_SITE}/llms.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await response.text() }] };
    }
  );
}
