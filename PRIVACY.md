# Privacy

## What this server processes

It is a stateless wrapper over the Hardal Analytics API. It stores no analytics
data, keeps no database, writes no files, and retains nothing between requests
apart from a short-lived auth token held in memory for the life of the process.

Data flows in one direction only: an MCP client asks a question, the server
queries the Hardal Analytics API for the signal the caller authenticated as, and
returns the answer. Nothing is forwarded to any third party.

## Personal data

**None of the tools return per-visitor records.** All three answer with
aggregates only — counts, totals, rankings, and time series:

| Tool | Returns |
|---|---|
| `get_analytics_overview` | Totals and top-N lists over a date range |
| `get_analytics_event_counts` | Counts, sessions, and visitors per event name |
| `get_top_campaigns` | Campaign and channel rankings |

Individual session records — which would carry a pseudonymous visitor
identifier, coarse location, and referrer — are deliberately not exposed. The
Analytics API can return them; this server does not surface them, so no
personal data reaches the MCP client or the model behind it.

Aggregate figures may still be indirectly identifying at very low counts (a
single visitor from a small city on a single day). Operators reading such
figures should treat them with the same care they would in any analytics UI.

## Retention

None. The server holds no analytics data after a response is sent. Retention of
the underlying data is governed by your Hardal account, not by this server.

## Logging

Operational logs record that a request happened and whether it failed. They
never contain signal tokens, JWTs, tool arguments, or response bodies.

## Contact

support@usehardal.com
