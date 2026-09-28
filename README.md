# NetAPI MCP server

An [MCP](https://modelcontextprotocol.io/) server that gives AI assistants and agents (Claude, Cursor, ChatGPT, Windsurf, VS Code Copilot and any other MCP client) access to [NetAPI](https://netapi.com/) domain intelligence: registered domains of 1,584 TLDs, newly registered and deleted domains, DNS-provider and registrar data, the free NetAPI Top 1M popularity ranking and the compromised domain / IP feed.

**Endpoints (Streamable HTTP):**

| URL | Who | What |
|-----|-----|------|
| `https://mcp.netapi.com/mcp` | signed-in NetAPI account (OAuth, or `Authorization: Bearer <api_token>`) | all tools; a free account is enough for the free tools with higher limits, a [plan](https://netapi.com/plans/) unlocks the paid ones |
| `https://mcp.netapi.com/mcp/public` | no account | the free tools only (the account and plan tools are not listed there), anonymous limits |

## Tools

Free (no plan needed):

| Tool | What it answers |
|------|-----------------|
| `check_compromised` | Is this domain or IP in the compromised feed (malware, phishing, abuse)? Seen in the last 24 h or ever, block reason, registrar. |
| `search_new_domains` | Domains registered in the last 1-7 days that contain a string: brand monitoring, typosquatting, phishing, keyword trends. |
| `tld_stats` | Registry, active domains, new / deleted in 24 h, growth over 7-365 days, abuse rate, Top 1M presence, policies of a TLD. |
| `domain_rank` | Rank of a domain in the NetAPI Top 1M and inside its TLD. |
| `top_websites` | The most popular websites of a country or TLD (Germany = .de, .fr, .io ...). |
| `top_1m` | A slice of the Top 1M list. |
| `registrar_info` | Size, rank and abuse rate of a registrar. |
| `dns_provider_info` | Domains, market share and growth of a DNS provider. |
| `list_zones` | All 1,584 zones with their figures. |

With a [NetAPI plan](https://netapi.com/plans/):

| Tool | What it answers |
|------|-----------------|
| `lookup_domain` | Nameservers, IP, country, registration / expiration dates, registrar of a domain. |
| `lookup_ip` | Domains hosted on an IP (reverse IP). |
| `get_download_url` | A 24-hour link to a domain list or dataset file: the domains of a zone (active / new / deleted, one zone or all zones), of a DNS provider or of a registrar. Lists = domain names (any plan), datasets = one row per domain with nameservers, IP, country, emails, phones (Plus or Pro). |
| `account_info` | Plan and limits of the connected account. |

Free data (Top 1M, compromised feeds) is published under CC BY 4.0: credit NetAPI and link to `https://netapi.com/`. Full description of the tools and the connection steps: [netapi.com/help/mcp/](https://netapi.com/help/mcp/).

## Connect

The server speaks standard MCP OAuth (authorization server `https://netapi.com`, dynamic client registration, PKCE), so clients that support it show a NetAPI sign-in when you add `https://mcp.netapi.com/mcp`: sign in with your email code or Google, click **Allow access**, done. Connected apps are listed in your [dashboard](https://netapi.com/dashboard/), where you can disconnect them.

**claude.ai / Claude Desktop:** Settings → Connectors → Add custom connector → URL `https://mcp.netapi.com/mcp` → Connect.

**ChatGPT:** Settings → Connectors (developer mode) → Add → MCP server URL `https://mcp.netapi.com/mcp`, authentication OAuth.

**Claude Code**

```bash
claude mcp add --transport http netapi https://mcp.netapi.com/mcp
```

then `/mcp` inside Claude Code to sign in. Without an account:

```bash
claude mcp add --transport http netapi https://mcp.netapi.com/mcp/public
```

**Cursor** (`~/.cursor/mcp.json` or the project's `.cursor/mcp.json`): Cursor signs in through OAuth when you add the URL; a NetAPI API token works as well:

```json
{
  "mcpServers": {
    "netapi": {
      "url": "https://mcp.netapi.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_TOKEN" }
    }
  }
}
```

**Other clients:** add a remote MCP server of type "http" / "streamable-http" with one of the URLs above.

## Rate limits

Without an account (`/mcp/public`): 30 requests per minute and 1,000 per day per IP for point lookups, 10 / 200 for list tools, 6 / 100 for `search_new_domains` (100 results per call). A free NetAPI account raises them to 60 / 5,000, 30 / 1,000 and 30 / 500 (500 results per call); paid plans raise them further, unlock `lookup_domain`, `lookup_ip` and `get_download_url`, and Pro has no daily caps. Limits and error messages come from the JSON API: see the [request-limit table](https://netapi.com/help/api/#rate-limits) and the [MCP server page](https://netapi.com/help/mcp/).

## How it works

The Worker is a thin layer: every tool call is one GET request to the NetAPI JSON API (`https://netapi.com/api-json/`), the answer is returned to the client as JSON text. Tokens are validated by the site and cached for a minute; nothing else is stored in the Worker. `/.well-known/oauth-protected-resource` points clients to the authorization server. Files are never streamed through it: `get_download_url` returns a temporary link instead.

## Development

```bash
npm install
npm run typecheck
npm run dev        # http://localhost:8787/mcp (and /mcp/public)
npm run deploy     # wrangler deploy (or connect the repo in the Cloudflare dashboard)
```

Test with the MCP Inspector: `npx @modelcontextprotocol/inspector`, add a Streamable HTTP server with `http://localhost:8787/mcp/public` (or the production URL to test the sign-in).

## MCP Registry

The server is listed in the [MCP Registry](https://registry.modelcontextprotocol.io/) as `com.netapi/mcp` (remote `https://mcp.netapi.com/mcp`); `server.json` is its manifest. A new version: bump `version` in `server.json`, `mcp-publisher login http --domain netapi.com` (domain proof via `/.well-known/mcp-registry-auth`; `dns` works too), then `mcp-publisher publish` from this directory.

## License

MIT for the code in this repository. NetAPI data is subject to the [Terms of Service](https://netapi.com/tos/); the free datasets are CC BY 4.0.
