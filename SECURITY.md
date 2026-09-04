# Security

## Reporting a vulnerability

Email **support@usehardal.com**. Please do not open a public issue for a
suspected vulnerability. We aim to acknowledge within two business days.

## What this server can do

It is read-only. The Hardal Analytics API it wraps exposes no mutation
endpoints, and the server issues no writes of its own. There is no shell
execution, no filesystem access, and no way for a tool argument to reach
anything other than a query string or JSON body sent to
`https://api.nexus.usehardal.com`.

## Credentials

A signal id and token from your Hardal dashboard, passed as
`HARDAL_SIGNAL_ID` / `HARDAL_SIGNAL_TOKEN` environment variables. They live in
your MCP client's local config and are sent only to the Hardal Analytics API,
never logged, never echoed in an error response.

## Data handled

Every tool returns aggregates — counts, totals, rankings, time series. Per-session
records, which would carry a pseudonymous visitor id and coarse location, are
deliberately not exposed, so no personal data passes through this server. See
[PRIVACY.md](./PRIVACY.md).
