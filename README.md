<p align="center">
  <img src="./assets/icon.svg" width="88" height="88" alt="Hardal">
</p>

<h1 align="center">Hardal MCP</h1>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-141020">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-141020">
</p>

A remote [MCP](https://modelcontextprotocol.io) server for querying your [Hardal](https://usehardal.com) analytics from Claude, ChatGPT, or any other MCP client — ask about traffic, events, acquisition, funnels, and campaigns in plain language. You sign in with your own Hardal account, and the server only ever sees the workspaces you approve.

## Connect

The server is hosted — there is nothing to install. Add it as a remote (streamable-HTTP) MCP server:

```
https://mcp.usehardal.com
```

- **Claude (web, Desktop, Code) and ChatGPT:** add the URL as a custom MCP connector. The client opens a browser, you sign in with Hardal and choose which workspaces (tenants) to share. Every request is then scoped to what you approved.
- **A stdio-only client?** Bridge it with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "hardal": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.usehardal.com"]
    }
  }
}
```

There are no API keys or tokens to copy — sign-in and workspace access are handled through OAuth.

## Tools

The [report coverage matrix](docs/report-coverage.md) lists each tool variant, its Beacon endpoint, and the supported inputs.

Call `get_context` first to list your workspaces and pick a `tenantId`; the report tools take it from there.

| Tool | What it answers |
|---|---|
| `get_context` | Which organizations, tenants and sources you can query (with each tenant's report type and currency) |
| `get_overview` | What happened over a date range — visitor/session/page-view totals, bounce & consent rates, top pages/referrers/locations, and a time series |
| `get_breakdown` | Traffic broken down by one dimension — acquisition (channels/sources/campaigns), top pages, or events |
| `compare_periods` | Two date ranges side by side — e.g. this month vs last month |
| `get_events` | Which events fire and how often, with per-event counts, sessions and visitors |
| `get_funnels` | A tenant's saved funnels, or one funnel's conversion summary over a date range |

Every tool is read-only and returns aggregates only.

## Timezone

Every report tool accepts an optional `timezone` (an IANA name such as `Europe/Istanbul` or `UTC`). An explicit value always takes precedence. When it is omitted, every tenant defaults to `Europe/Istanbul`, and each answer states the timezone it used in its filters line — so the same question yields the same numbers whether or not you pass it.

V1 has no per-tenant timezone setting. If a workspace's Hardal dashboard is configured for a different timezone, day boundaries — and therefore totals — can differ between the dashboard and MCP answers; pass `timezone` explicitly to match the dashboard.

## How it works

Hardal MCP signs you in through Hardal's own authorization server (OAuth 2.1): clients discover it via `GET /.well-known/oauth-protected-resource` and a `401` `WWW-Authenticate` challenge. The server validates your token and, to read your reports, exchanges it for a scoped Reports-API token — your token itself never reaches the reporting API. Access is limited to the tenants you consented to, and revoking the connection (or an admin revoking access) stops it on the next request.

## Develop

```bash
bun install
cp .env.example .env
bun run service-identity:generate   # writes keys/{public,private}.jwk.json
bun run dev                         # http://localhost:1922
```

Register the generated public key with a running Beacon:

```bash
# from the beacon/apps/api checkout
DATABASE_URL=<beacon db> bun run scripts/register-oauth-service-identity.ts \
  --client-id hardal-mcp \
  --name "Hardal MCP" \
  --jwk <mcp>/keys/public.jwk.json \
  --operations introspect,token_exchange
```

In production the service private key lives in Azure Key Vault (`SERVICE_PRIVATE_JWK_VAULT_URL`).

## Privacy & Support

Every tool returns aggregates only — counts, totals, rankings, time series — never per-visitor records, so no personal data passes through this server. Access is read-only and scoped to the workspaces you approve.

Questions or a vulnerability to report: **support@usehardal.com**.

## License

MIT — see [LICENSE](./LICENSE).
