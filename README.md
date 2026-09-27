# NetAPI MCP server

An [MCP](https://modelcontextprotocol.io/) server that gives AI assistants and agents (Claude, Cursor, ChatGPT, Windsurf, VS Code Copilot and any other MCP client) access to [NetAPI](https://netapi.com/) domain intelligence: registered domains of 1,584 TLDs, newly registered and deleted domains, DNS-provider and registrar data, the free NetAPI Top 1M popularity ranking and the compromised domain / IP feed.

**Endpoint:** `https://mcp.netapi.com/mcp` (Streamable HTTP)

## Tools

Free, no account needed:

| Tool | What it answers |
|------|-----------------|
| `check_compromised` | Is this domain or IP in the compromised feed (malware, phishing, abuse)? Seen in the last 24 h or ever, block reason, registrar. |
| `search_new_domains` | Domains registered in the last 1-7 days that contain a string: brand monitoring, typosquatting, phishing, keyword trends. |
| `tld_stats` | Registry, active domains, new / deleted in 24 h, growth over 7-365 days, abuse rate, Top 1M presence, policies of a TLD. |
| `domain_rank` | Rank of a domain in the NetAPI Top 1M and inside its TLD. |
| `top_websites` | The most popular websites of a TLD (top .de, .fr, .jp ...). |
| `top_1m` | A slice of the Top 1M list. |
| `registrar_info` | Size, rank and abuse rate of a registrar. |
| `dns_provider_info` | Domains, market share and growth of a DNS provider. |
| `list_zones` | All 1,584 zones with their figures. |

With a [NetAPI plan](https://netapi.com/plans/) (`Authorization: Bearer <api_token>`, the token is in the [dashboard](https://netapi.com/dashboard/)):

| Tool | What it answers |
|------|-----------------|
| `lookup_domain` | Nameservers, IP, country, registration / expiration dates, registrar of a domain. |
| `lookup_ip` | Domains hosted on an IP (reverse IP). |
| `get_download_url` | A 24-hour link to a domain list or dataset file (active / new / deleted domains, one zone or all zones). |
| `account_info` | Plan and limits of the connected account. |

Free data (Top 1M, compromised feeds) is published under CC BY 4.0: credit NetAPI and link to `https://netapi.com/`.

## Connect

**Claude Code**

```bash
claude mcp add --transport http netapi https://mcp.netapi.com/mcp
```

With a NetAPI plan:

```bash
claude mcp add --transport http netapi https://mcp.netapi.com/mcp --header "Authorization: Bearer YOUR_API_TOKEN"
```

**Cursor** (`~/.cursor/mcp.json` or the project's `.cursor/mcp.json`)

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

Leave out `headers` for the free tools only.

**Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → URL `https://mcp.netapi.com/mcp`.

**Other clients:** add an MCP server of type "http" / "streamable-http" with the URL above.

## Rate limits

Free tools: 30 requests per minute and 1,000 per day per IP for point lookups, 10 / 200 for list tools, 6 / 100 for `search_new_domains` (100 results per call). A NetAPI account raises the limits; Pro has no daily caps. Limits and error messages come from the JSON API, see the [API documentation](https://netapi.com/help/api/).

## How it works

The Worker is a thin layer: every tool call is one GET request to the NetAPI JSON API (`https://netapi.com/api-json/`), the answer is returned to the client as JSON text. No data is stored in the Worker. Files are never streamed through it: `get_download_url` returns a temporary link instead.

## Development

```bash
npm install
npm run typecheck
npm run dev        # http://localhost:8787/mcp
npm run deploy     # wrangler deploy (or connect the repo in the Cloudflare dashboard)
```

Test with the MCP Inspector: `npx @modelcontextprotocol/inspector` and connect to `http://localhost:8787/mcp`.

## License

MIT for the code in this repository. NetAPI data is subject to the [Terms of Service](https://netapi.com/tos/); the free datasets are CC BY 4.0.
