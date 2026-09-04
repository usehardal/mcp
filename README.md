<p align="center">
  <img src="./assets/icon.svg" width="88" height="88" alt="Hardal">
</p>

<h1 align="center">Hardal MCP</h1>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-141020">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-141020">
</p>

An [MCP](https://modelcontextprotocol.io) server for querying your [Hardal](https://usehardal.com) analytics from Claude Desktop, Claude Code, or any other MCP client — ask about traffic, events, and campaigns in plain language instead of digging through a dashboard.

## Setup

Add this to your MCP client config — `claude_desktop_config.json` for Claude Desktop (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`), or a project-level `.mcp.json` for Claude Code:

```json
{
  "mcpServers": {
    "hardal": {
      "command": "npx",
      "args": ["-y", "usehardal-mcp"],
      "env": {
        "HARDAL_SIGNAL_ID": "your-signal-id",
        "HARDAL_SIGNAL_TOKEN": "your-signal-token"
      }
    }
  }
}
```

Both values come from your Hardal dashboard. Requires Node.js 20 or newer; `npx` fetches the server on demand, so there is nothing to install.

| Variable | Required | Default |
|---|---|---|
| `HARDAL_SIGNAL_ID` | yes | — |
| `HARDAL_SIGNAL_TOKEN` | yes | — |
| `HARDAL_API_BASE_URL` | no | `https://api.nexus.usehardal.com` |
| `HARDAL_REQUEST_TIMEOUT_MS` | no | `30000` |

## Tools

| Tool | What it answers |
|---|---|
| `get_analytics_overview` | What happened over a date range — totals, top pages, referrers, locations, browser/device/OS split, and a time series |
| `get_analytics_event_counts` | Which events fire, and how often |
| `get_top_campaigns` | Where traffic came from, ranked by revenue, conversions, sessions, or conversion rate |

All three are read-only, and all take an optional `start_date`/`end_date` (defaulting to the last 30 days).

## Privacy & Support

Every tool returns aggregates only — counts, totals, rankings, time series — never per-visitor records, so no personal data passes through this server. Nothing is stored or forwarded to any third party.

Questions or a vulnerability to report: **support@usehardal.com**.

## License

MIT — see [LICENSE](./LICENSE).
