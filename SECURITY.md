# Security

## Reporting a vulnerability

Report a vulnerability privately: on this repository's **Security** tab, choose
**Report a vulnerability**. Please don't open a public issue for it.

The rest of this file guides anyone reviewing a change here for security, a
person or an AI reviewer. `REVIEW.md` sets the priorities.

## What this repo protects

- **User tokens:** Beacon access tokens for `MCP_RESOURCE`, sent by MCP clients.
- **Exchanged tokens:** per-user Reports API tokens from
  `src/oauth/token-exchange.ts`, cached in memory by `src/oauth/exchange-cache.ts`.
- **The service private key:** the ES256 JWK that signs the server's
  `private_key_jwt` assertions, loaded by `src/oauth/service-key.ts` from Key
  Vault in production and from a local file only in development.
- **The selection key:** `MCP_REPORT_SELECTION_KEY`, which seals Commerce
  selection ids in `src/reports/item-selection.ts`.
- **Customers' report data:** reports for the tenants each user approved.

## Trust boundaries

- **MCP clients.** The bearer token and every tool argument are untrusted.
  `src/modules/mcp/routes.ts` introspects the token and answers 401 unless it
  is active and its audience is `MCP_RESOURCE`.
- **The token exchange.** The server signs a 60-second assertion
  (`src/oauth/service-assertion.ts`) to introspect the user's token and to
  exchange it for a Reports API token. The user's token goes nowhere else.
- **Beacon's Reports API (`/v1`).** Called only with the exchanged token.
  Beacon is the authority on tenant access and quotas; its responses are
  size-capped, and its error detail reaches the client only as a short code.

## What to flag

Most severe first.

1. A token, the service private key or the selection key logged, returned,
   put in an error message or written to disk. Watch `logger` metadata,
   `ToolFailure` messages and errors rethrown from `fetch`.
2. An MCP request served without introspection or with the wrong audience; a
   tool registered without `guard()`, which skips the tenant check.
3. A report scoped beyond the user's `tenantIds`, or a weakened
   `grantedTenantId` in `src/tools/output/result.ts`.
4. The user's token sent anywhere instead of exchanged, or an MCP token
   accepted for the Reports API.
5. Calls to Sirius, ClickHouse, Beacon's internal APIs or any URL not built by
   `buildUrl` in `src/reports/client.ts`.
6. Tool input in a URL path. `buildUrl` appends the path to
   `REPORTS_API_RESOURCE`, and `%2e%2e` segments climb out of `/v1` even after
   `encodeURIComponent`. A path segment from input must be a schema-validated
   ID, as `funnelId` is (`z.uuid()`); other input goes in the query or a JSON
   body.
7. One user's token or data reaching another request: state shared across
   requests (each request gets a new server and stateless transport), a
   cache keyed on anything but the user's token, or a selection id opened
   outside the scope it was sealed for.
8. The rate limits (`src/reports/rate-limit.ts`), in-flight caps
   (`src/reports/limits.ts`), tool deadline or upstream body limit bypassed.
9. A generated key committed: `keys/*.jwk.json` or any JWK, `.env` file or
   credential, including keys written with `service-identity:generate --out`.
10. A new POST path in `ReportRequest`, or anything that could change data in
    Beacon; every tool is read-only.
11. Internal hostnames, IP addresses or other non-public details in this repo.

## Safe patterns

- Call Beacon only through `reportsApiRequest` or `reportsApiRequests` in
  `src/reports/client.ts`: they check the user, apply the rate limits,
  exchange the token with `exchangeReportsApiToken` and build the URL.
- Wrap every tool handler in `guard()` from `src/tools/output/result.ts`.
- Return errors as `ToolFailure` with a fixed literal message. `toolFailure()`
  in `src/tools/output/errors.ts` passes a coded message's text to the client
  as is, so a coded message must be a literal too, never built from an upstream
  error, a token or user data.
- Seal and open Commerce selections with `sealItemSelection` and
  `openItemSelection`.

## Out of scope

The stubbed `fetch` and Beacon responses in `tests/`, the throwaway signing key
from `tests/setup.ts`, and the local defaults in `src/config/env.ts` and
`.env.example`. A test that calls a real Beacon, or a committed secret, is in
scope.
