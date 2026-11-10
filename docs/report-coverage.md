# Hardal MCP V1 report coverage

Beacon's [versioned OpenAPI](https://github.com/usehardal/beacon/blob/7e4c59f/apps/api/openapi/v1.json) defines the request and response wire format. The [V1 tool contract](https://linear.app/hardal/document/nebula-mcp-v1-tool-contract-e712037dd67d) defines the report capabilities and MCP filter rules. The table maps them to the existing tool names.

For calendar reports, common scope means an authorized tenant, optional source, and an inclusive reporting period in the selected timezone. The default timezone is Europe/Istanbul. Calendar series default to daily buckets. Page Trends and Page Flow accept slash-prefixed paths of up to 2,048 characters without query strings or fragments. Realtime uses a rolling window and catalog queries accept only the scope shown. The API paths below include the `/v1` resource prefix.

| MCP tool and variant | Beacon operation | Supported inputs beyond common scope | Result |
| --- | --- | --- | --- |
| `get_context` | `GET /v1/workspace/access` | Limit, offset | Authorized tenants, organizations, sources and reporting currency |
| `get_overview` overview | `GET /v1/reports/overview` | Interval, path, channel, marketing source, device, OS, country, city, event name | Scorecards, previous scorecards and aggregate time series |
| `get_overview` realtime | `GET /v1/reports/realtime` | Tenant, optional source, window of 1 to 60 minutes | Rolling visitor, session and event counts |
| `get_overview` pages | `GET /v1/reports/pages/metrics` | Common scope | Current and previous page metrics |
| `get_overview` page_trends | `POST /v1/reports/pages/time-series` | Interval, up to 8 page paths, page path limit and offset | Page path catalog and per-path time series |
| `get_overview` sessions | `GET /v1/reports/sessions/metrics` | Engaged event names | Session and engagement metric comparisons |
| `get_overview` sessions trend | `GET /v1/reports/sessions/trends` | Engaged event names, interval, optional includeTrend | Aggregate session and engagement time series |
| `get_overview` commerce | `GET /v1/reports/commerce` | Interval | Revenue, orders, AOV, item metrics, trends and top channels/sources |
| `get_overview` ai_visibility | `GET /v1/reports/ai-visibility` | AI toggle, agent type/name/platform/category, page path | AI Visibility scorecards |
| `get_overview` ai_visibility trend, `get_breakdown` agentName/agentPlatform/agentCategory/pagePath | `GET /v1/reports/ai-visibility/graphs` | Same AI filters, interval and graph dimension for breakdown | Full time series within the point budget, with separately paginated category totals for breakdowns |
| `get_breakdown` overview | `GET /v1/reports/overview` | Overview filters, limit/offset and channels, sources, countries, cities, devices, browsers, operating systems or pages | Selected aggregate breakdown |
| `get_breakdown` acquisition | `GET /v1/reports/acquisition` | Attribution, consent, event metrics, AI focus, one distribution filter, breakdown/group, columns, sorting and pagination | Scorecards, traffic and distribution |
| `compare_periods` acquisition | `GET /v1/reports/acquisition` | Attribution, consent, event metrics and AI focus | Both effective periods and absolute/relative changes in Acquisition scorecards |
| `compare_periods` overview | `GET /v1/reports/overview` | Overview filters, previous period, previous year or explicit comparison dates | Both effective periods and absolute/relative metric changes |
| `get_breakdown` pages top/attribution | `GET /v1/reports/pages/top` | Limit and offset. Attribution also accepts `pageLimit` and `pageOffset` to select the underlying top pages | Top pages or attribution rows with separate top-page pagination |
| `get_breakdown` pages entry/exit | `GET /v1/reports/pages/entry-exit` | Limit, offset zero | Entry or exit pages and session shares |
| `get_breakdown` pages flow | `GET /v1/reports/pages/flow` | Destination path, steps, per-step limit | Aggregate Page Flow edges and destination paths |
| `get_breakdown` commerce items | `GET /v1/reports/commerce/items` | Item filter, grouping, columns, sorting, limit and offset | Aggregate items or groups with opaque selection IDs |
| `get_breakdown` commerce group_items/attribution | `POST /v1/reports/commerce/items/details` | Selection ID, pagination, column and sort controls for group items | Grouped item rows or the selected item's attribution rows |
| `get_breakdown` AI pageAgent | `GET /v1/reports/ai-visibility/page-report` | AI toggle, page path, local pagination | Aggregate page-by-agent visits |
| `get_breakdown` AI options | `GET /v1/reports/ai-visibility/filter-options` | AI filters, option dimension, search, bounded pagination | Supported filter labels and counts |
| `get_events` overview, `get_breakdown` events | `GET /v1/reports/events/overview` | Event metric and conversion names, paired timeline filter, interval, metrics-only and option pagination on `get_events` | Aggregate event metrics, timeline and event options |
| `get_events` acquisition options | `GET /v1/reports/acquisition/event-options` | Search, limit and offset | Acquisition event names and labels |
| `get_events` commerce options | `GET /v1/reports/commerce/event-options` | Limit and offset | Commerce event names |
| `get_events` funnel options | `GET /v1/funnels/options/events` | Tenant, optional source, timezone, search and local pagination | Funnel event names and labels |
| `get_funnels` list | `GET /v1/funnels` | Tenant, optional source, local pagination | Saved funnel catalog |
| `get_funnels` metadata | `GET /v1/funnels/{funnelId}` | Tenant and saved funnel ID | Saved funnel definition and source |
| `get_funnels` saved | `GET /v1/funnels/{funnelId}/summary` | Saved funnel ID and calendar period; source resolved from the definition | Funnel summary, step performance and drop-offs |
| `get_funnels` saved breakdown | `GET /v1/funnels/{funnelId}/breakdown` | Saved scope, up to 2 breakdown keys, search, sort and pagination | Aggregate breakdown table with the summary |
| `get_funnels` preview | `POST /v1/funnels/preview` | Definition with 2 to 10 consecutive steps and up to 2 breakdown keys | Ordered step counts without saving a funnel |
| `get_breakdown` funnel_pages options | `GET /v1/funnels/options/pages` | Search, limit and offset | Funnel page path options |
| `get_breakdown` funnel_breakdowns options | `GET /v1/funnels/options/breakdowns` | Tenant only | Supported funnel breakdown keys |

Beacon Events uses tenant conversion settings when conversion event names are omitted. The Events API requires at least one name for an explicit override. An empty Acquisition conversion selection is sent as an empty string, which Beacon's Acquisition contract accepts. Acquisition supports up to 10 event metric names. Events, Sessions and Acquisition accept lists of separate event names. Individual names containing commas or starting with `[` are rejected because Beacon's query parser changes their meaning.

Overview path filters and AI Visibility summary, graph and filter-option path filters reject commas because Sirius splits them into separate paths. AI page-by-agent filters and explicit Page Trends paths accept literal commas. Page Trends requests with a positive catalog offset and no explicit paths use a daily interval to fetch catalog rows without chart series. Funnel Preview step values support up to 2,048 characters.

Existing calls without the new report or mode arguments still select their original report. The V1 contract's workspace and funnel catalog names are represented by `get_context` and the modes of `get_funnels`. Pages attribution totals remain unknown because Beacon's top-page total describes a different row set.

Commerce selections use authenticated encryption and expire after 15 minutes. Set `MCP_REPORT_SELECTION_KEY` to the same secret 32-byte base64url value on all MCP replicas. Each selection binds the current Beacon access token, user, client, tenant, source, explicit dates, timezone, selected item or group, and original item filter. A selection ID is a URL-safe string of 16 to 72,000 characters. Beacon reauthorizes each detail request and returns a settings version based on the effective currency and conversion events. MCP requires the version to match the original list request. Deploy the Beacon change that supplies `meta.reportSettingsVersion` before enabling Commerce drill-down in this MCP build. A refreshed access token requires reselection because Beacon introspection exposes no grant ID. Rotating the selection key also expires existing selections.

DEV-4084 owns the full output allowlists, masking and common response envelope. DEV-4085 owns the shared quota, concurrency and deadline policy. This matrix covers the DEV-4230 report calls.
