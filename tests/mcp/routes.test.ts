import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { resetDiscoveryCache } from "../../src/oauth/discovery";
import { resetExchangeCache } from "../../src/oauth/exchange-cache";
import * as introspection from "../../src/oauth/introspection";
import {
  authorizationServerMetadata, beaconFixtureFetch, calls, commerce, compareArgs, counters,
  paths, previewDefinition, range, reportScope, resetFixtureState, routeCases,
  sourceId, sourceScope, tenantId,
} from "./v1-fixtures";

let introspectionResult: unknown = { active: false };
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

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await post({ authorization: `Bearer ${token}` }, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(response.status).toBe(200);
  const { result } = await response.json() as {
    result: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: { data: Record<string, any>; context: Record<string, any> } };
  };
  return result;
}

beforeEach(() => {
  spyOn(introspection, "introspectToken").mockImplementation(async () =>
    introspectionResult as Awaited<ReturnType<typeof introspection.introspectToken>>
  );
});

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

describe("POST / report requests", () => {
  const configuredLimit = config.reports.rateLimitPerMinute;

  afterEach(() => {
    config.reports.rateLimitPerMinute = configuredLimit;
    resetDiscoveryCache();
    resetExchangeCache();
    mock.restore();
  });

  it("shares a user's budget across tokens, exchanges once per subject token and reserves both comparison reads", async () => {
    config.reports.rateLimitPerMinute = 2;
    let now = Date.now();
    spyOn(Date, "now").mockImplementation(() => now);

    const beacon = config.oauth.beaconApiUrl;
    const exchangedTokens: string[] = [];
    const reportedStartDates: Array<string | null> = [];
    const beaconFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${beacon}/.well-known/oauth-authorization-server`) {
        return Response.json(authorizationServerMetadata());
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
    expect(exchangedTokens).toEqual(["original", "refreshed", "other-user"]);
    expect(reportedStartDates.slice(2).sort()).toEqual(["2025-12-01", "2026-01-01"]);

    now += 60_000;
    expect((await callTool("other-user", "get_overview", { tenantId })).isError).toBeUndefined();
    expect(exchangedTokens).toEqual(["original", "refreshed", "other-user"]);
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

describe("POST / runtime bounds", () => {
  const configuredDeadline = config.reports.toolDeadlineMs;
  const configuredWait = config.reports.concurrencyWaitMs;
  const configuredUserCap = config.reports.userMaxInFlight;

  afterEach(() => {
    config.reports.toolDeadlineMs = configuredDeadline;
    config.reports.concurrencyWaitMs = configuredWait;
    config.reports.userMaxInFlight = configuredUserCap;
    resetDiscoveryCache();
    resetExchangeCache();
    mock.restore();
  });

  function slowBeaconFetch(reportDelayMs: number) {
    const beacon = config.oauth.beaconApiUrl;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${beacon}/.well-known/oauth-authorization-server`) return Response.json(authorizationServerMetadata());
      if (url === `${beacon}/oauth/token`) return Response.json({ access_token: "delegated-slow", expires_in: 300 });
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ success: true, data: {} })), reportDelayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation timed out.", "TimeoutError"));
        });
      });
    }) as typeof fetch;
  }

  it("cuts a tool call at the deadline and answers with a retryable deadline-exceeded", async () => {
    config.reports.toolDeadlineMs = 1000;
    spyOn(globalThis, "fetch").mockImplementation(slowBeaconFetch(5000));
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "deadline-user");
    const result = await callTool("deadline-token", "get_overview", { tenantId });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("deadline-exceeded");
    expect(JSON.parse(result.content[1]!.text)).toMatchObject({ ok: false, error: { code: "deadline-exceeded", retryable: true } });
  }, 5000);

  it("admits per tool call and answers tenant-busy when the user slots stay full", async () => {
    config.reports.userMaxInFlight = 1;
    config.reports.concurrencyWaitMs = 50;
    spyOn(globalThis, "fetch").mockImplementation(slowBeaconFetch(300));
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "busy-user");
    const [first, second] = await Promise.all([
      callTool("busy-token", "get_overview", { tenantId }),
      callTool("busy-token", "get_overview", { tenantId }),
    ]);
    expect([first, second].filter((result) => result.isError === true)).toHaveLength(1);
    const busy = first.isError ? first : second;
    expect(busy.content[0].text).toContain("tenant-busy");
    expect(JSON.parse(busy.content[1]!.text)).toMatchObject({ ok: false, error: { code: "tenant-busy", retryable: true } });
  }, 5000);

  it.each([
    ["get_overview", { ...reportScope, report: "sessions" }],
    ["get_events", reportScope],
    ["get_breakdown", { ...reportScope, report: "ai_visibility", dimension: "agentName" }],
  ] as const)("rejects a %s series beyond 2,000 points after the response", async (tool, args) => {
    const big = Array.from({ length: 2001 }, (_, index) => ({
      date: "2026-04-01", value: index, visits: index, sessions: index, categoryValue: "crawler",
    }));
    const beacon = config.oauth.beaconApiUrl;
    spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${beacon}/.well-known/oauth-authorization-server`) return Response.json(authorizationServerMetadata());
      if (url === `${beacon}/oauth/token`) return Response.json({ access_token: "delegated-big", expires_in: 300 });
      return Response.json({
        success: true,
        data: { range, series: big, points: big, timeSeries: big, metrics: {}, timelineEventOptions: [] },
      });
    }) as typeof fetch);
    introspectionResult = activeTokenFor(config.oauth.mcpResource, `points-user-${tool}`);
    const result = await callTool("points-token", tool, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("response-too-large");
  });
});

describe("MCP V1 report coverage", () => {
  const configuredSelectionKey = config.reports.selectionKey;
  const configuredLimit = config.reports.rateLimitPerMinute;

  beforeEach(() => {
    resetFixtureState();
    config.reports.selectionKey = Buffer.alloc(32, 73).toString("base64url");
    config.reports.rateLimitPerMinute = 300;
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "coverage-user");
    spyOn(globalThis, "fetch").mockImplementation(beaconFixtureFetch());
  });

  afterEach(() => {
    config.reports.selectionKey = configuredSelectionKey;
    config.reports.rateLimitPerMinute = configuredLimit;
    resetDiscoveryCache();
    resetExchangeCache();
    mock.restore();
  });

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
    const graph = result.structuredContent?.data.report as { points: unknown[]; rows: unknown[] };
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
    expect(first.structuredContent?.data.report).toMatchObject({
      pagination: { offset: 0, returnedRows: 20, hasMore: true, truncated: true },
      topPagesPagination: { offset: 5, limit: 10, total: 72 },
    });
    const report = second.structuredContent?.data.report as { rows: unknown[] };
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
    expect(catalog.structuredContent?.data.report).toMatchObject({ interval: "day", pagePaths: ["/catalog"], series: [] });
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
    expect(pageResult.structuredContent).toMatchObject({ data: { report: { series: [{ pagePath: "/catalog", pageViews: 8 }] } } });
    expect(funnelResult.structuredContent?.data.report).toEqual({ steps: [{ stepOrder: 1, stepLabel: "Catalog", value: 9 }] });
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
    expect(result.structuredContent?.data.appliedFilters).toMatchObject({ consent: "consented_traffic" });
    expect(result.structuredContent?.data.report).toMatchObject({ trafficDistribution: { rows: [{ source: "direct", sessions: 9 }] } });
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
    expect(counters.exchanges).toBe(0);
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
    expect(counters.exchanges).toBe(0);
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
    expect(counters.exchanges).toBe(0);
  });

  it("computes Acquisition period changes and preserves a zero comparison value", async () => {
    const result = await callTool("coverage-token", "compare_periods", {
      ...reportScope, report: "acquisition", comparison: { mode: "previous_period" },
    });
    expect(calls.map(({ query }) => [query.get("startDate"), query.get("endDate")]).sort()).toEqual([
      ["2026-03-25", "2026-03-31"], ["2026-04-01", "2026-04-07"],
    ]);
    expect(result.structuredContent?.data.metrics).toMatchObject({
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
    const report = list.structuredContent?.data.report as { rows: Array<{ selectionId: string }> };
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
    const report = list.structuredContent?.data.report as { rows: Array<{ selectionId: string }> };
    commerce.settingsVersion = "b".repeat(64);
    const detail = await callTool("coverage-token", "get_breakdown", {
      ...options, dimension: "attribution", selectionId: report.rows[0]!.selectionId,
    });
    expect(detail.isError).toBe(true);
    expect(detail.content[0]?.text).toContain("selection-expired");
    expect(detail.structuredContent).toBeUndefined();
    expect(JSON.parse(detail.content[1]!.text)).toMatchObject({ ok: false, error: { code: "selection-expired", retryable: false } });
  });

  it("round-trips a long Commerce selection using the advertised input schema", async () => {
    const options = { ...reportScope, report: "commerce" };
    commerce.itemKey = "\u0001".repeat(8192);
    const list = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "items" });
    const report = list.structuredContent?.data.report as { rows: Array<{ selectionId: string }> };
    const selectionId = report.rows[0]!.selectionId;
    expect(selectionId.length).toBeGreaterThan(16_000);
    expect(selectionId.length).toBeLessThanOrEqual(72_000);
    const detail = await callTool("coverage-token", "get_breakdown", { ...options, dimension: "attribution", selectionId });
    expect(detail.isError).toBeUndefined();
    expect(calls[1]?.body).toMatchObject({ itemKeys: [commerce.itemKey] });
  });

  it("uses opaque, credential-bound Commerce selections for both drill-down variants", async () => {
    const options = { ...reportScope, report: "commerce" };
    const list = await callTool("coverage-token", "get_breakdown", {
      ...options, dimension: "items", groupBy: "brand", filters: { filter: { field: "brand", value: "Hardal" } },
    });
    expect(list.isError).toBeUndefined();
    const report = list.structuredContent?.data.report as { rows: Array<{ selectionId: string }> };
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
    expect(group.structuredContent?.data.report).toMatchObject({ rows: [{ item_id: "sku-2", orders: 3 }] });
    expect(attribution.structuredContent?.data.report).toMatchObject({ rows: [{ source: "direct", orders: 6 }] });
    expect(JSON.stringify(group)).not.toContain("internal-child");
    expect(JSON.stringify(attribution)).not.toContain("internal-composite");
    expect(calls.slice(1).map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", paths.itemDetails, { kind: "group-items", groupBy: "brand", groupKey: "internal-composite", filterField: "brand", filterValue: "Hardal", limit: 20, offset: 0 }],
      ["POST", paths.itemDetails, { kind: "attribution", groupBy: "brand", itemKeys: ["internal-composite"], filterField: "brand", filterValue: "Hardal", limit: 20, offset: 0 }],
    ]);
  });
});
