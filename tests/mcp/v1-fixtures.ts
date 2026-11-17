import { config } from "../../src/config";

export const tenantId = "11111111-1111-4111-8111-111111111111";
export const sourceId = "22222222-2222-4222-8222-222222222222";
export const funnelId = "33333333-3333-4333-8333-333333333333";

export const compareArgs = {
  tenantId,
  currentStart: "2026-01-01",
  currentEnd: "2026-01-31",
  previousStart: "2025-12-01",
  previousEnd: "2025-12-31",
};

export const reportScope = {
  tenantId, sourceId,
  period: { startDate: "2026-04-01", endDate: "2026-04-07" },
  timezone: "Europe/Berlin",
};
export const savedScope = { tenantId, period: reportScope.period, timezone: reportScope.timezone };
export const sourceScope = { tenantId, sourceId };
export const range = { ...reportScope.period, timezone: reportScope.timezone };
export const paths = {
  overview: "/reports/overview",
  acquisition: "/reports/acquisition",
  sessionsMetrics: "/reports/sessions/metrics",
  sessionsTrends: "/reports/sessions/trends",
  graphs: "/reports/ai-visibility/graphs",
  items: "/reports/commerce/items",
  itemDetails: "/reports/commerce/items/details",
  summary: `/funnels/${funnelId}/summary`,
  breakdown: `/funnels/${funnelId}/breakdown`,
};
export const currency = { reportingCurrency: "TRY", status: "complete", excludedCount: 0 };
export const page = { pagePath: "/catalog", sessions: 9, consentedVisitors: 8 };
export const previewDefinition = {
  steps: [
    { stepOrder: 1, stepType: "page", stepValue: "/catalog/" + "p".repeat(2039) },
    { stepOrder: 2, stepType: "event", stepValue: "purchase" },
  ],
  breakdowns: [],
};

export type BeaconCall = { path: string; method: string; query: URLSearchParams; body: unknown; bearer: string | null };

export const calls: BeaconCall[] = [];
export const counters = { exchanges: 0 };
export const commerce = { settingsVersion: "a".repeat(64), itemKey: "internal-composite" };

export function resetFixtureState() {
  calls.length = 0;
  counters.exchanges = 0;
  commerce.settingsVersion = "a".repeat(64);
  commerce.itemKey = "internal-composite";
}

export function authorizationServerMetadata() {
  const beacon = config.oauth.beaconApiUrl;
  return {
    issuer: config.oauth.issuer,
    token_endpoint: `${beacon}/oauth/token`,
    introspection_endpoint: `${beacon}/oauth/introspect`,
    authorization_endpoint: `${beacon}/oauth/authorize`,
    registration_endpoint: `${beacon}/oauth/register`,
    revocation_endpoint: `${beacon}/oauth/revoke`,
    scopes_supported: ["reports:read"],
  };
}

export function beaconFixtureFetch(): typeof fetch {
  const beacon = config.oauth.beaconApiUrl;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = String(input);
    if (rawUrl === `${beacon}/.well-known/oauth-authorization-server`) {
      return Response.json(authorizationServerMetadata());
    }
    if (rawUrl === `${beacon}/oauth/token`) {
      counters.exchanges += 1;
      return Response.json({ access_token: "delegated-fixture", expires_in: 300, scope: "reports:read" });
    }
    const resource = config.oauth.reportsApiResource;
    if (!rawUrl.startsWith(`${resource}/`)) throw new Error(`Unexpected fixture URL: ${rawUrl}`);
    const url = new URL(rawUrl);
    const path = url.pathname.slice(new URL(resource).pathname.length);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({
      path, method: init?.method ?? "GET", query: url.searchParams, body,
      bearer: new Headers(init?.headers).get("Authorization"),
    });
    const scores = url.searchParams.get("startDate") === "2026-03-25"
      ? { sessions: { value: 0 }, conversions: { value: 5 } }
      : { sessions: { value: 9 }, conversions: { value: 10 } };
    const responses: Record<string, unknown> = {
      "/workspace/access": { tenants: [] },
      [paths.overview]: { range, scoreCards: { sessions: 9 }, pages: [page], sessionBreakdowns: { browsers: [{ value: "Chrome", sessions: 8 }] } },
      "/reports/realtime": { windowMinutes: 12, consentedVisitors: 3, sessions: 4, events: 5 },
      "/reports/pages/metrics": { range, metrics: { sessions: { current: 9, previous: 8 } } },
      "/reports/pages/top": {
        range, rows: [page],
        attributionRows: Array.from({ length: 30 }, (_, index) => ({
          ...page, campaign: `campaign-${url.searchParams.get("offset") ?? 0}-${index}`,
        })),
        pagination: { total: 72 },
      },
      "/reports/pages/entry-exit": { range, entryPages: [page], exitPages: [page] },
      "/reports/pages/flow": { range, destinationPath: "/catalog", edges: [{ step: 1, from: "/", to: "/catalog", sessions: 7 }] },
      "/reports/pages/time-series": {
        range, interval: url.searchParams.get("interval"), pagePaths: ["/catalog"],
        series: Number(url.searchParams.get("pagePathOffset")) > 0 && !body?.pagePaths
          ? [] : [{ date: "2026-04-01", pagePath: "/catalog", pageViews: 8 }],
      },
      [paths.sessionsMetrics]: { range, metrics: { engagedSessions: { current: 8, previous: 7 } } },
      [paths.sessionsTrends]: { range, series: [{ date: "2026-04-01", sessions: 9, engagedSessions: 8 }] },
      "/reports/commerce": { range, currency, scoreCards: { orders: { value: 6 } } },
      [paths.items]: { range, currency, rows: [{ itemKey: commerce.itemKey, item_id: "sku-1", orders: 6 }], pagination: { total: 1 } },
      [paths.itemDetails]: body?.kind === "group-items"
        ? { range, currency, rows: [{ itemKey: "internal-child", item_id: "sku-2", orders: 3 }], pagination: { total: 1 } }
        : { range, items: [{ itemKey: commerce.itemKey, currency, rows: [{ source: "direct", orders: 6 }], pagination: { total: 1 } }] },
      "/reports/ai-visibility": { range, scoreCards: { aiAgentVisits: 17 } },
      [paths.graphs]: {
        range, points: Array.from({ length: 30 }, (_, index) => ({
          date: `2026-04-${String(index + 1).padStart(2, "0")}`, categoryValue: "crawler", visits: 17,
        })),
      },
      "/reports/ai-visibility/page-report": { range, rows: [{ pagePath: "/catalog", agentName: "crawler", isAi: true, visits: 17 }] },
      "/reports/ai-visibility/filter-options": { options: [{ value: "crawler", label: "crawler", count: 17 }] },
      "/reports/events/overview": { range, metrics: { totalEvents: { current: 44, previous: 20 } }, timelineEventOptions: [{ eventName: "purchase" }] },
      [paths.acquisition]: { range, controls: { trafficScope: "consented_traffic" }, scoreCards: scores, trafficDistribution: { rows: [{ source: "direct", sessions: 9 }], pagination: { total: 1 } } },
      "/reports/acquisition/event-options": { items: [{ eventName: "purchase", eventLabel: "Purchase" }] },
      "/reports/commerce/event-options": { items: [{ eventName: "purchase" }] },
      "/funnels/options/events": { items: [{ eventName: "purchase", eventLabel: "Purchase" }] },
      "/funnels/options/pages": { items: [{ pagePath: "/catalog" }] },
      "/funnels/options/breakdowns": { items: [{ breakdownKey: "source", breakdownLabel: "Source" }] },
      "/funnels": { items: [{ funnelId, funnelName: "Checkout" }], total: 1 },
      [`/funnels/${funnelId}`]: { funnelId, funnelName: "Checkout", sourceId },
      [paths.summary]: { range, funnelSummary: { entryCount: 9, completedCount: 3 } },
      [paths.breakdown]: { range, breakdownTable: { rows: [{ breakdownValues: { source: "direct" }, stepCounts: [9, 3] }] } },
      "/funnels/preview": { range, steps: [{ stepOrder: 1, stepLabel: "Catalog", value: 9, unexpected: "private" }] },
    };
    if (!(path in responses)) throw new Error(`Missing Beacon fixture for ${path}`);
    const meta = path === paths.items || path === paths.itemDetails
      ? { reportSettingsVersion: commerce.settingsVersion }
      : undefined;
    return Response.json({ success: true, data: responses[path], meta });
  }) as typeof fetch;
}

export const routeCases: Array<[string, Record<string, unknown>, string[]]> = [
  ["get_context", {}, ["/workspace/access"]],
  ["get_overview", reportScope, [paths.overview]],
  ["get_overview", { ...sourceScope, report: "realtime", windowMinutes: 12 }, ["/reports/realtime"]],
  ["get_overview", { ...reportScope, report: "pages" }, ["/reports/pages/metrics"]],
  ["get_overview", { ...reportScope, report: "sessions", engagedEventNames: ["purchase"] }, [paths.sessionsMetrics, paths.sessionsTrends]],
  ["get_overview", { ...reportScope, report: "commerce" }, ["/reports/commerce"]],
  ["get_overview", { ...reportScope, report: "ai_visibility", filters: { isAi: true } }, ["/reports/ai-visibility", paths.graphs]],
  ["get_breakdown", { ...reportScope, report: "overview", dimension: "browsers" }, [paths.overview]],
  ["get_breakdown", { ...reportScope, dimension: "acquisition" }, [paths.acquisition]],
  ["get_breakdown", { ...reportScope, report: "pages", dimension: "top" }, ["/reports/pages/top"]],
  ["get_breakdown", { ...reportScope, report: "pages", dimension: "attribution" }, ["/reports/pages/top"]],
  ["get_breakdown", { ...reportScope, report: "pages", dimension: "entry" }, ["/reports/pages/entry-exit"]],
  ["get_breakdown", { ...reportScope, report: "pages", dimension: "exit" }, ["/reports/pages/entry-exit"]],
  ["get_breakdown", { ...reportScope, report: "pages", dimension: "flow" }, ["/reports/pages/flow"]],
  ["get_breakdown", { ...reportScope, report: "ai_visibility", dimension: "agentName" }, [paths.graphs]],
  ["get_breakdown", { ...reportScope, report: "ai_visibility", dimension: "pageAgent", filters: { isAi: true, pagePath: "/catalog" } }, ["/reports/ai-visibility/page-report"]],
  ["get_breakdown", { ...reportScope, mode: "options", target: "ai_visibility", dimension: "pagePath" }, ["/reports/ai-visibility/filter-options"]],
  ["get_breakdown", { ...reportScope, mode: "options", target: "funnel_pages" }, ["/funnels/options/pages"]],
  ["get_breakdown", { tenantId, mode: "options", target: "funnel_breakdowns" }, ["/funnels/options/breakdowns"]],
  ["get_events", reportScope, ["/reports/events/overview"]],
  ["get_events", { ...reportScope, mode: "options", target: "acquisition" }, ["/reports/acquisition/event-options"]],
  ["get_events", { ...reportScope, mode: "options", target: "commerce" }, ["/reports/commerce/event-options"]],
  ["get_events", { ...sourceScope, mode: "options", target: "funnel", search: "purchase" }, ["/funnels/options/events"]],
  ["get_funnels", sourceScope, ["/funnels"]],
  ["get_funnels", { tenantId, mode: "metadata", funnelId }, [`/funnels/${funnelId}`]],
  ["get_funnels", { ...savedScope, funnelId, breakdown: { keys: ["source"] } }, [paths.summary, paths.breakdown]],
];
