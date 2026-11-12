import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { resetDiscoveryCache } from "../../src/oauth/discovery";

let introspectionResult: unknown = { active: false };

mock.module("../../src/oauth/introspection", () => ({
  introspectToken: async () => introspectionResult,
}));

const { mcpRoutes } = await import("../../src/modules/mcp/routes");
const { config } = await import("../../src/config");

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function post(headers: Record<string, string> = {}, message: object = initialize) {
  return mcpRoutes.handle(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(message),
    }),
  );
}

function activeTokenFor(resource: string, userId = "user-1") {
  return {
    active: true,
    userId,
    clientId: "client-1",
    scopes: ["reports:read"],
    tenantIds: [tenantId],
    resource,
    expiresAt: null,
  };
}

describe("POST / authentication", () => {
  it("rejects a request with no bearer token", async () => {
    introspectionResult = { active: false };
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects an inactive token", async () => {
    introspectionResult = { active: false };
    const res = await post({ authorization: "Bearer dead" });
    expect(res.status).toBe(401);
  });

  it("rejects an active token issued for the Reports API resource [P2]", async () => {
    introspectionResult = activeTokenFor(config.oauth.reportsApiResource);
    const res = await post({ authorization: "Bearer reports-api-token" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error_description?: string };
    expect(body.error_description).toContain("MCP server");
  });

  it("accepts an active token issued for the MCP resource", async () => {
    introspectionResult = activeTokenFor(config.oauth.mcpResource);
    const res = await post({ authorization: "Bearer mcp-token" });
    expect(res.status).toBe(200);
  });
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const compareArgs = {
  tenantId,
  currentStart: "2026-01-01",
  currentEnd: "2026-01-31",
  previousStart: "2025-12-01",
  previousEnd: "2025-12-31",
};

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await post({ authorization: `Bearer ${token}` }, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(response.status).toBe(200);
  const { result } = await response.json() as {
    result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
  };
  return result;
}

describe("POST / report requests", () => {
  const configuredLimit = config.reports.rateLimitPerMinute;

  afterEach(() => {
    config.reports.rateLimitPerMinute = configuredLimit;
    resetDiscoveryCache();
    mock.restore();
  });

  it("shares a user's budget across tokens and reserves both comparison reads before exchange", async () => {
    config.reports.rateLimitPerMinute = 2;
    let now = Date.now();
    spyOn(Date, "now").mockImplementation(() => now);

    const beacon = config.oauth.beaconApiUrl;
    const exchangedTokens: string[] = [];
    const reportedStartDates: Array<string | null> = [];
    const beaconFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${beacon}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: config.oauth.issuer,
          token_endpoint: `${beacon}/oauth/token`,
          introspection_endpoint: `${beacon}/oauth/introspect`,
          authorization_endpoint: `${beacon}/oauth/authorize`,
          registration_endpoint: `${beacon}/oauth/register`,
          revocation_endpoint: `${beacon}/oauth/revoke`,
          scopes_supported: ["reports:read"],
        });
      }
      if (url === `${beacon}/oauth/token`) {
        const fields = new URLSearchParams(String(init?.body));
        exchangedTokens.push(fields.get("subject_token") ?? "");
        return Response.json({ access_token: "delegated-token", expires_in: 300, scope: "reports:read" });
      }
      if (url.startsWith(`${config.oauth.reportsApiResource}/reports/overview?`)) {
        reportedStartDates.push(new URL(url).searchParams.get("startDate"));
        return Response.json({ success: true, data: {} });
      }
      throw new Error(`Unexpected upstream request to ${url}`);
    }) as typeof fetch;
    spyOn(globalThis, "fetch").mockImplementation(beaconFetch);

    introspectionResult = activeTokenFor(config.oauth.mcpResource, "report-user-a");
    expect((await callTool("original", "get_overview", { tenantId })).isError).toBeUndefined();
    const blocked = await callTool("refreshed", "compare_periods", compareArgs);
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("Retry in 60 seconds");
    expect(exchangedTokens).toEqual(["original"]);

    expect((await callTool("refreshed", "get_overview", { tenantId })).isError).toBeUndefined();
    expect((await callTool("refreshed", "get_context", {})).isError).toBe(true);
    expect(exchangedTokens).toEqual(["original", "refreshed"]);

    introspectionResult = activeTokenFor(config.oauth.mcpResource, "report-user-b");
    expect((await callTool("other-user", "compare_periods", compareArgs)).isError).toBeUndefined();
    expect((await callTool("other-user", "get_overview", { tenantId })).isError).toBe(true);
    expect(exchangedTokens).toEqual(["original", "refreshed", "other-user", "other-user"]);
    expect(reportedStartDates.slice(2).sort()).toEqual(["2025-12-01", "2026-01-01"]);

    now += 60_000;
    expect((await callTool("other-user", "get_overview", { tenantId })).isError).toBeUndefined();
    expect(exchangedTokens).toHaveLength(5);
  });

  it("rejects a single date before contacting the Reports API or exchanging a token", async () => {
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "invalid-range-user");
    const upstream = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected upstream request"));
    const result = await callTool("mcp-token", "get_overview", { tenantId, startDate: "2026-01-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide both startDate and endDate");
    expect(upstream).not.toHaveBeenCalled();
  });
});

const sourceId = "22222222-2222-4222-8222-222222222222";
const funnelId = "33333333-3333-4333-8333-333333333333";
const reportScope = {
  tenantId, sourceId,
  period: { startDate: "2026-04-01", endDate: "2026-04-07" },
  timezone: "Europe/Berlin",
};
const savedScope = { tenantId, period: reportScope.period, timezone: reportScope.timezone };
const sourceScope = { tenantId, sourceId };
const range = { ...reportScope.period, timezone: reportScope.timezone };
const paths = {
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
const currency = { reportingCurrency: "TRY", status: "complete", excludedCount: 0 };
const page = { pagePath: "/catalog", sessions: 9, consentedVisitors: 8 };
const previewDefinition = {
  steps: [
    { stepOrder: 1, stepType: "page", stepValue: "/catalog/" + "p".repeat(2039) },
    { stepOrder: 2, stepType: "event", stepValue: "purchase" },
  ],
  breakdowns: [],
};

type BeaconCall = { path: string; method: string; query: URLSearchParams; body: unknown; bearer: string | null };

describe("MCP V1 report coverage", () => {
  const configuredSelectionKey = config.reports.selectionKey;
  const configuredLimit = config.reports.rateLimitPerMinute;
  let calls: BeaconCall[];
  let exchanges: number;
  let commerceSettingsVersion: string;
  let commerceItemKey: string;

  beforeEach(() => {
    calls = [];
    exchanges = 0;
    commerceSettingsVersion = "a".repeat(64);
    commerceItemKey = "internal-composite";
    config.reports.selectionKey = Buffer.alloc(32, 73).toString("base64url");
    config.reports.rateLimitPerMinute = 300;
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "coverage-user");
    const beacon = config.oauth.beaconApiUrl;
    const beaconFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = String(input);
      if (rawUrl === `${beacon}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: config.oauth.issuer,
          token_endpoint: `${beacon}/oauth/token`,
          introspection_endpoint: `${beacon}/oauth/introspect`,
          authorization_endpoint: `${beacon}/oauth/authorize`,
          registration_endpoint: `${beacon}/oauth/register`,
          revocation_endpoint: `${beacon}/oauth/revoke`,
          scopes_supported: ["reports:read"],
        });
      }
      if (rawUrl === `${beacon}/oauth/token`) {
        exchanges += 1;
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
        [paths.items]: { range, currency, rows: [{ itemKey: commerceItemKey, item_id: "sku-1", orders: 6 }], pagination: { total: 1 } },
        [paths.itemDetails]: body?.kind === "group-items"
          ? { range, currency, rows: [{ itemKey: "internal-child", item_id: "sku-2", orders: 3 }], pagination: { total: 1 } }
          : { range, items: [{ itemKey: commerceItemKey, currency, rows: [{ source: "direct", orders: 6 }], pagination: { total: 1 } }] },
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
        ? { reportSettingsVersion: commerceSettingsVersion }
        : undefined;
      return Response.json({ success: true, data: responses[path], meta });
    }) as typeof fetch;
    spyOn(globalThis, "fetch").mockImplementation(beaconFetch);
  });

  afterEach(() => {
    config.reports.selectionKey = configuredSelectionKey;
    config.reports.rateLimitPerMinute = configuredLimit;
    resetDiscoveryCache();
    mock.restore();
  });

  const routeCases: Array<[string, Record<string, unknown>, string[]]> = [
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

  it.each(routeCases)("routes %s %j to the expected Beacon GET operations", async (tool, args, expectedPaths) => {
    const result = await callTool("coverage-token", tool, args);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeDefined();
    expect(calls.map((call) => call.path).sort()).toEqual([...expectedPaths].sort());
    expect(calls.every((call) => call.method === "GET" && call.bearer === "Bearer delegated-fixture")).toBe(true);
    for (const call of calls) {
      if (args.tenantId) expect(call.query.getAll("tenantId")).toEqual([tenantId]);
      expect(call.query.get("sourceId")).toBe(typeof args.sourceId === "string" ? args.sourceId : null);
      if (args.period) {
        expect(call.query.get("startDate")).toBe("2026-04-01");
        expect(call.query.get("endDate")).toBe("2026-04-07");
        expect(call.query.get("timezone")).toBe("Europe/Berlin");
      }
    }
  });

  it("keeps every AI graph point while paginating category rows", async () => {
    const result = await callTool("coverage-token", "get_breakdown", {
      ...reportScope, report: "ai_visibility", dimension: "agentName", limit: 1,
    });
    const graph = result.structuredContent?.report as { points: unknown[]; rows: unknown[] };
    expect(result.isError).toBeUndefined();
    expect(graph.points).toHaveLength(30);
    expect(graph.points[29]).toMatchObject({ date: "2026-04-30" });
    expect(graph.rows).toEqual([{ value: "crawler", visits: 510 }]);
  });

  it("paginates attribution rows independently of the selected Top Pages", async () => {
    const args = { ...reportScope, report: "pages", dimension: "attribution", limit: 20, pageLimit: 10, pageOffset: 5 };
    const first = await callTool("coverage-token", "get_breakdown", args);
    const second = await callTool("coverage-token", "get_breakdown", { ...args, offset: 20 });
    expect(calls.map(({ query }) => [query.get("limit"), query.get("offset")])).toEqual([["10", "5"], ["10", "5"]]);
    expect(first.structuredContent?.report).toMatchObject({
      pagination: { offset: 0, returnedRows: 20, hasMore: true },
      topPagesPagination: { offset: 5, limit: 10, total: 72 },
    });
    const report = second.structuredContent?.report as { rows: unknown[] };
    expect(report.rows).toHaveLength(10);
    expect(report.rows[0]).toMatchObject({ campaign: "campaign-5-20" });
  });

  it("uses the daily interval for a 90-day Overview without an explicit interval", async () => {
    const result = await callTool("coverage-token", "get_overview", {
      ...sourceScope, period: { startDate: "2026-01-01", endDate: "2026-03-31" },
    });
    expect(result.isError).toBeUndefined();
    expect(calls[0]?.query.get("interval")).toBe("day");
  });

  it("allows a catalog-only Page Trends page while enforcing the budget on explicit series", async () => {
    const args = {
      ...reportScope, report: "page_trends", interval: "hour", pagePathOffset: 20,
      period: { startDate: "2026-01-01", endDate: "2026-03-31" },
    };
    const catalog = await callTool("coverage-token", "get_overview", args);
    expect(catalog.isError).toBeUndefined();
    expect(catalog.structuredContent?.report).toMatchObject({ interval: "day", pagePaths: ["/catalog"], series: [] });
    expect(calls[0]?.query.get("pagePathOffset")).toBe("20");
    expect(calls[0]?.query.get("interval")).toBe("day");
    expect(calls[0]?.body).toEqual({});
    const series = await callTool("coverage-token", "get_overview", { ...args, pagePaths: ["/one", "/two", "/three"] });
    expect(series.isError).toBe(true);
    expect(series.content[0]?.text).toContain("response-too-large");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["get_overview", { report: "overview" }, "path", false],
    ["get_overview", { report: "ai_visibility", includeTrend: false }, "pagePath", false],
    ["get_breakdown", { report: "ai_visibility", dimension: "pagePath" }, "pagePath", false],
    ["get_breakdown", { mode: "options", target: "ai_visibility", dimension: "pagePath" }, "pagePath", false],
    ["get_breakdown", { report: "ai_visibility", dimension: "pageAgent" }, "pagePath", true],
  ] as const)("validates path filters in %s with %j", async (tool, variant, field, literalPath) => {
    const path = literalPath ? "/," + "p".repeat(2046) : "/" + "p".repeat(2047);
    const args = { ...reportScope, ...variant };
    const valid = await callTool("coverage-token", tool, { ...args, filters: { [field]: path } });
    expect(valid.isError).toBeUndefined();
    expect(calls[0]?.query.get(field)).toBe(path);
    for (const value of ["/catalog?x=1", "/catalog#section", path + "p", ...(!literalPath ? ["/blue,red"] : [])]) {
      const invalid = await callTool("coverage-token", tool, { ...args, filters: { [field]: value } });
      expect(invalid.isError).toBe(true);
    }
    expect(calls).toHaveLength(1);
  });

  it("accepts long Page paths and rejects query strings or fragments", async () => {
    const path = "/" + "p".repeat(2047);
    expect((await callTool("coverage-token", "get_overview", {
      ...reportScope, report: "page_trends", pagePaths: [path],
    })).isError).toBeUndefined();
    expect((await callTool("coverage-token", "get_breakdown", {
      ...reportScope, report: "pages", dimension: "flow", destinationPath: path,
    })).isError).toBeUndefined();
    expect(calls[0]?.body).toEqual({ pagePaths: [path] });
    expect(calls[1]?.query.get("destinationPath")).toBe(path);
    for (const value of ["/catalog?token=fixture", "/catalog#private", "https://example.test/catalog", path + "p"]) {
      const result = await callTool("coverage-token", "get_overview", {
        ...reportScope, report: "page_trends", pagePaths: [value],
      });
      expect(result.isError).toBe(true);
    }
    expect(calls).toHaveLength(2);
  });

  it("sends Page Trends and Funnel Preview JSON to only the read-only POST paths", async () => {
    const pageResult = await callTool("coverage-token", "get_overview", { ...reportScope, report: "page_trends", pagePaths: ["/catalog"] });
    const funnelResult = await callTool("coverage-token", "get_funnels", { ...reportScope, mode: "preview", definition: previewDefinition });
    expect(pageResult.structuredContent).toMatchObject({ report: { series: [{ pagePath: "/catalog", pageViews: 8 }] } });
    expect(funnelResult.structuredContent?.report).toEqual({ steps: [{ stepOrder: 1, stepLabel: "Catalog", value: 9 }] });
    expect(calls.map(({ path, method, body }) => ({ path, method, body }))).toEqual([
      { path: "/reports/pages/time-series", method: "POST", body: { pagePaths: ["/catalog"] } },
      { path: "/funnels/preview", method: "POST", body: previewDefinition },
    ]);
    for (const call of calls) {
      expect(call.query.getAll("tenantId")).toEqual([tenantId]);
      expect(call.query.getAll("sourceId")).toEqual([sourceId]);
      expect(call.query.get("timezone")).toBe("Europe/Berlin");
      expect(call.query.get("startDate")).toBe("2026-04-01");
    }
  });

  it("leaves Acquisition consent to Beacon and returns its effective scope", async () => {
    const result = await callTool("coverage-token", "get_breakdown", {
      ...reportScope, report: "acquisition", dimension: "campaigns",
      filters: {
        eventMetricNames: ["view_item", "purchase"], conversionEventNames: ["purchase", "signup"],
        filter: { field: "campaign", value: "spring-sale" },
      },
    });
    expect(calls[0]?.query.get("breakdownMode")).toBe("campaigns");
    expect(calls[0]?.query.get("trafficScope")).toBeNull();
    expect(calls[0]?.query.getAll("eventMetricNames")).toEqual(["view_item", "purchase"]);
    expect(calls[0]?.query.getAll("conversionEventNames")).toEqual(["purchase", "signup"]);
    expect(calls[0]?.query.get("filterField")).toBe("campaign");
    expect(calls[0]?.query.get("filterValue")).toBe("spring-sale");
    expect(result.structuredContent?.appliedFilters).toMatchObject({ consent: "consented_traffic" });
    expect(result.structuredContent?.report).toMatchObject({ trafficDistribution: { rows: [{ source: "direct", sessions: 9 }] } });
  });

  it("rejects unsupported inputs before contacting Beacon", async () => {
    for (const [tool, args] of [
      ["get_breakdown", { ...reportScope, report: "ai_visibility", dimension: "pageAgent", filters: { agentName: "crawler" } }],
      ["get_overview", { ...reportScope, report: "realtime" }],
      ["get_events", { ...reportScope, mode: "options", target: "commerce", search: "purchase" }],
      ["get_overview", { ...reportScope, unknownField: true }],
      ["get_breakdown", { ...reportScope, dimension: "acquisition", filters: { eventMetricNames: Array.from({ length: 11 }, (_, index) => `event-${index}`) } }],
      ["get_funnels", { ...reportScope, mode: "preview", definition: { ...previewDefinition, steps: [
        { ...previewDefinition.steps[0], stepValue: "/" + "p".repeat(2048) }, previewDefinition.steps[1],
      ] } }],
    ] as const) {
      const result = await callTool("coverage-token", tool, args);
      expect(result.isError).toBe(true);
    }
    expect(calls).toHaveLength(0);
    expect(exchanges).toBe(0);
  });

  it("preserves an explicit empty Acquisition conversion selection", async () => {
    const result = await callTool("coverage-token", "get_breakdown", {
      ...reportScope, dimension: "acquisition", filters: { conversionEventNames: [] },
    });
    expect(result.isError).toBeUndefined();
    expect(calls[0]?.query.getAll("conversionEventNames")).toEqual([""]);
  });

  it("rejects Acquisition distribution filters on period comparisons before contacting Beacon", async () => {
    const result = await callTool("coverage-token", "compare_periods", {
      ...reportScope, report: "acquisition", comparison: { mode: "previous_period" },
      filters: { filter: { field: "campaign", value: "spring-sale" } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unsupported-filter: filter is unsupported for acquisition period comparison");
    expect(calls).toHaveLength(0);
    expect(exchanges).toBe(0);
  });

  it.each(["review,event", "[review]"])("rejects ambiguous event name %s before contacting Beacon", async (name) => {
    const names = [name, "signup"];
    for (const [tool, args] of [
      ["get_breakdown", { dimension: "acquisition", filters: { conversionEventNames: names } }],
      ["get_breakdown", { dimension: "acquisition", filters: { eventMetricNames: names } }],
      ["compare_periods", { report: "acquisition", comparison: { mode: "previous_period" }, filters: { conversionEventNames: names } }],
      ["get_events", { conversionEventNames: names }],
      ["get_events", { metricEventNames: names }],
      ["get_events", { timeline: { mode: "include", eventNames: names } }],
      ["get_overview", { report: "sessions", engagedEventNames: names }],
    ] as const) {
      const result = await callTool("coverage-token", tool, { ...reportScope, ...args });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Event names cannot contain commas or start with an opening bracket");
    }
    expect(calls).toHaveLength(0);
    expect(exchanges).toBe(0);
  });

  it("computes Acquisition period changes and preserves a zero comparison value", async () => {
    const result = await callTool("coverage-token", "compare_periods", {
      ...reportScope, report: "acquisition", comparison: { mode: "previous_period" },
    });
    expect(calls.map(({ query }) => [query.get("startDate"), query.get("endDate")]).sort()).toEqual([
      ["2026-03-25", "2026-03-31"], ["2026-04-01", "2026-04-07"],
    ]);
    expect(result.structuredContent?.metrics).toMatchObject({
      sessions: { current: 9, previous: 0, absoluteChange: 9, relativeChangePercent: null, reason: "previous-zero" },
      conversions: { current: 10, previous: 5, absoluteChange: 5, relativeChangePercent: 100 },
    });
  });

  it("clamps leap day for previous-year comparisons using the same reporting timezone", async () => {
    const result = await callTool("coverage-token", "compare_periods", {
      tenantId, sourceId, timezone: "Europe/Berlin",
      period: { startDate: "2024-02-29", endDate: "2024-02-29" },
      comparison: { mode: "previous_year" },
    });
    expect(result.isError).toBeUndefined();
    expect(calls.map(({ query }) => [query.get("startDate"), query.get("endDate"), query.get("timezone")]).sort()).toEqual([
      ["2023-02-28", "2023-02-28", "Europe/Berlin"],
      ["2024-02-29", "2024-02-29", "Europe/Berlin"],
    ]);
  });

  it("rejects a Commerce selection at its expiration before making another report request", async () => {
    let now = Date.now();
    spyOn(Date, "now").mockImplementation(() => now);
    const options = { ...reportScope, report: "commerce" };
    const list = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "items" });
    const report = list.structuredContent?.report as { rows: Array<{ selectionId: string }> };
    const selectionId = report.rows[0]!.selectionId;
    now += 15 * 60_000;
    const expired = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "attribution", selectionId });
    expect(expired.isError).toBe(true);
    expect(expired.content[0]?.text).toContain("selection-expired");
    expect(calls).toHaveLength(1);
  });

  it("rejects a Commerce selection when the settings version changes without a currency change", async () => {
    const options = { ...reportScope, report: "commerce" };
    const list = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "items" });
    const report = list.structuredContent?.report as { rows: Array<{ selectionId: string }> };
    commerceSettingsVersion = "b".repeat(64);
    const detail = await callTool("coverage-token", "get_breakdown", {
      ...options, dimension: "attribution", selectionId: report.rows[0]!.selectionId,
    });
    expect(detail.isError).toBe(true);
    expect(detail.content[0]?.text).toContain("selection-expired");
    expect(detail.structuredContent).toBeUndefined();
  });

  it("round-trips a long Commerce selection using the advertised input schema", async () => {
    const options = { ...reportScope, report: "commerce" };
    commerceItemKey = "\u0001".repeat(8192);
    const list = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "items" });
    const report = list.structuredContent?.report as { rows: Array<{ selectionId: string }> };
    const selectionId = report.rows[0]!.selectionId;
    expect(selectionId.length).toBeGreaterThan(16_000);
    expect(selectionId.length).toBeLessThanOrEqual(72_000);
    const detail = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "attribution", selectionId });
    expect(detail.isError).toBeUndefined();
    expect(calls[1]?.body).toMatchObject({ itemKeys: [commerceItemKey] });
  });

  it("uses opaque, credential-bound Commerce selections for both drill-down variants", async () => {
    const options = { ...reportScope, report: "commerce" };
    const list = await callTool("coverage-token", "get_breakdown", {
      ...options, dimension: "items", groupBy: "brand", filters: { filter: { field: "brand", value: "Hardal" } },
    });
    expect(list.isError).toBeUndefined();
    const report = list.structuredContent?.report as { rows: Array<{ selectionId: string }> };
    const selectionId = report.rows[0]!.selectionId;
    expect(JSON.stringify(list)).not.toContain("internal-composite");
    expect(Buffer.from(selectionId, "base64url").toString()).not.toContain("internal-composite");

    for (const [token, args] of [
      ["other-token", { ...options, dimension: "group_items", selectionId }],
      ["coverage-token", { ...options, sourceId: tenantId, dimension: "group_items", selectionId }],
      ["coverage-token", { ...options, dimension: "group_items", selectionId: selectionId.slice(5) }],
    ] as const) {
      expect((await callTool(token, "get_breakdown", args)).isError).toBe(true);
    }
    expect(calls).toHaveLength(1);

    const group = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "group_items", selectionId });
    const attribution = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "attribution", selectionId });
    expect(group.structuredContent?.report).toMatchObject({ rows: [{ item_id: "sku-2", orders: 3 }] });
    expect(attribution.structuredContent?.report).toMatchObject({ rows: [{ source: "direct", orders: 6 }] });
    expect(JSON.stringify(group)).not.toContain("internal-child");
    expect(JSON.stringify(attribution)).not.toContain("internal-composite");
    expect(calls.slice(1).map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", paths.itemDetails, { kind: "group-items", groupBy: "brand", groupKey: "internal-composite", filterField: "brand", filterValue: "Hardal", limit: 20, offset: 0 }],
      ["POST", paths.itemDetails, { kind: "attribution", groupBy: "brand", itemKeys: ["internal-composite"], filterField: "brand", filterValue: "Hardal", limit: 20, offset: 0 }],
    ]);
  });
});
