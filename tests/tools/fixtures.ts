export const tenantId = "11111111-1111-4111-8111-111111111111";
export const sourceId = "22222222-2222-4222-8222-222222222222";
export const funnelId = "33333333-3333-4333-8333-333333333333";

export const leakyPath = "/catalog?utm_source=leak#frag";
const extras = { nested: { note: "kept" }, extraMetric: 7 };
const range = { startDate: "2026-04-01", endDate: "2026-04-07", timezone: "Europe/Berlin" };
const previousRange = { startDate: "2026-03-25", endDate: "2026-03-31", timezone: "Europe/Berlin" };
const scores = { sessions: 9, consentedVisitors: 3, pageViews: 12, bounceRate: 0.5, sessionDuration: 30, totalEvents: 40, consentRate: 0.3, ...extras };
const metric = { current: 9, previous: 8, changePct: 12.5, ...extras };
const score = { value: 6, previousValue: 5, change: 1, changeRate: 20, formattedValue: "6", ...extras };
const page = { pagePath: leakyPath, pageTitle: "Catalog", sessions: 9, consentedVisitors: 8, pagesPerSession: 2, bounceRate: 0.4, scrollDepth: null, ...extras };
const currency = { reportingCurrency: "TRY", status: "available", excludedCount: 0 };
const funnel = {
  funnelId, funnelName: "Checkout", tenantId, sourceId, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
  steps: [{ stepOrder: 1, stepType: "page", stepValue: leakyPath }], breakdowns: [{ breakdownKey: "source", breakdownLabel: "Source" }], ...extras,
};

export const beaconFixtures: Record<string, Record<string, unknown>> = {
  "/workspace/access": {
    tenants: [{
      id: tenantId, name: "Store", reportType: "ecommerce", reportingCurrency: "TRY", organization: { id: "org-1", name: "Acme" },
      sources: [{ id: sourceId, name: "Website", domain: "example.test" }], ...extras,
    }],
  },
  "/reports/overview": {
    range, previousRange, scoreCards: scores, previousScoreCards: scores,
    timeSeries: [{ date: "2026-04-01", pageViews: 12, consentedVisitors: 3, sessions: 9, consentedSessions: 2, unconsentedSessions: 7, ...extras }],
    sessionBreakdowns: { browsers: [{ value: "Chrome", sessions: 8, ...extras }], operatingSystems: [], devices: [] },
    acquisitionBreakdowns: { channels: [{ value: "Direct", sessions: 5 }], sources: [] },
    pages: [page], locations: { countries: [{ countryCode: "TR", sessions: 4, consentedVisitors: 1 }], cities: [] }, ...extras,
  },
  "/reports/realtime": { windowMinutes: 12, consentedVisitors: 3, sessions: 4, events: 5, ...extras },
  "/reports/pages/metrics": { range, previousRange, metrics: { sessions: metric, scrollDepth: { current: null, previous: null, changePct: null } }, ...extras },
  "/reports/pages/top": {
    range, rows: [page], attributionRows: [{ ...page, source: "google", medium: "cpc", campaign: "spring" }], pagination: { limit: 20, offset: 0, total: 1 }, ...extras,
  },
  "/reports/pages/entry-exit": { range, entryPages: [{ pagePath: leakyPath, sessions: 9, share: 1, ...extras }], exitPages: [{ pagePath: leakyPath, sessions: 9, share: 1 }] },
  "/reports/pages/flow": {
    range, destinationPath: leakyPath, steps: 2, totalSessions: 9, edges: [{ step: 1, from: leakyPath, to: "/checkout", sessions: 7, ...extras }],
    destinationPaths: [leakyPath], ...extras,
  },
  "/reports/pages/time-series": {
    range, interval: "day", pagePaths: [leakyPath], maxSelectablePaths: 8, pagePathPagination: { limit: 20, offset: 0, hasMore: false },
    series: [{ date: "2026-04-01", pagePath: leakyPath, pageViews: 8, ...extras }], ...extras,
  },
  "/reports/sessions/metrics": { range, metrics: { engagedSessions: metric, sessionDuration: { ...metric, currentFormatted: "9s", previousFormatted: "8s" } }, ...extras },
  "/reports/sessions/trends": { range, series: [{ date: "2026-04-01", sessions: 9, engagedSessions: 8, ...extras }] },
  "/reports/commerce": {
    range, previousRange, interval: "day", currency, scoreCards: { orders: score, revenue: { ...score, value: null } },
    trend: [{ date: "2026-04-01", revenue: 10, orders: 1, ...extras }], topChannels: [{ channel: "Direct", sessions: 3, orders: 1, revenue: 10 }], topSources: [], ...extras,
  },
  "/reports/ai-visibility": { range, previousRange, scoreCards: { aiAgentVisits: 17, ...extras }, previousScoreCards: { aiAgentVisits: 12 }, ...extras },
  "/reports/ai-visibility/graphs": { range, points: [{ date: "2026-04-01", categoryValue: leakyPath, visits: 17 }], ...extras },
  "/reports/ai-visibility/page-report": { range, rows: [{ pagePath: leakyPath, agentName: "crawler", agentPlatform: "bot", agentCategory: "search", isAi: true, visits: 17, ...extras }] },
  "/reports/ai-visibility/filter-options": { options: [{ value: "crawler", label: "crawler", count: 17, ...extras }] },
  "/reports/events/overview": {
    range, previousRange, interval: "day", metrics: { totalEvents: { current: 44, previous: 20, ...extras } },
    timeline: [{ timestamp: "2026-04-01T00:00:00Z", eventName: "purchase", eventCount: 3, ...extras }],
    timelineEventOptions: [{ eventName: "purchase", eventLabel: "Purchase", eventCount: 3 }], ...extras,
  },
  "/reports/acquisition": {
    range, previousRange, currency, controls: { trafficScope: "consented_traffic", attributionModel: "last_touch", ...extras },
    scoreCards: { sessions: score, conversions: score }, trafficBreakdown: [{ date: "2026-04-01", sessions: 9, conversions: 1, ...extras }],
    trafficDistribution: {
      rows: [{ source: "direct", sessions: 9, eventCounts: { purchase: 2 }, ...extras }], pagination: { limit: 20, offset: 0, total: 1 },
      eventMetrics: [{ eventName: "purchase", eventLabel: "Purchase" }], columns: ["source"], groupBy: "none", sort: { sortBy: "sessions", sortDirection: "desc" },
    }, ...extras,
  },
  "/reports/acquisition/event-options": { items: [{ eventName: "purchase", eventLabel: "Purchase", ...extras }] },
  "/reports/commerce/event-options": { items: [{ eventName: "purchase" }] },
  "/funnels/options/events": { items: [{ eventName: "purchase", eventLabel: "Purchase", ...extras }] },
  "/funnels/options/pages": { items: [{ pagePath: leakyPath, ...extras }] },
  "/funnels/options/breakdowns": { items: [{ breakdownKey: "source", breakdownLabel: "Source", ...extras }] },
  "/funnels": { items: [funnel], total: 1, ...extras },
  [`/funnels/${funnelId}`]: funnel,
  [`/funnels/${funnelId}/summary`]: {
    range, funnelSummary: { entryCount: 9, completedCount: 3, conversionRate: 0.33, steps: [{ stepName: "Catalog", count: 9, share: 1, stepOrder: 1, stepType: "page", stepValue: leakyPath }] },
    stepPerformance: [{ stepName: "Catalog", count: 9, percentage: 100, stepOrder: 1, ...extras }],
    dropOffs: [{ type: "entry", fromStep: null, toStep: 1, entryCount: 9, dropOffCount: 0, dropOffRate: null }], ...extras,
  },
  [`/funnels/${funnelId}/breakdown`]: {
    range, breakdownTable: {
      columns: { breakdowns: [{ breakdownKey: "source", breakdownLabel: "Source" }], steps: [{ stepOrder: 1, stepName: "Catalog" }] },
      rows: [{ breakdownValues: { source: "direct" }, share: 1, stepCounts: [9, 3], stepRates: [1, 0.33], children: [{ breakdownValues: { source: "direct" }, share: 1, stepCounts: [9], stepRates: [1] }], ...extras }],
      totalRow: { breakdownValues: {}, share: 1, stepCounts: [9, 3], stepRates: [1, 0.33] },
      pagination: { limit: 10, offset: 0, total: 1 }, sort: { sortBy: "share", sortStep: null, sortDirection: "desc" }, search: "", ...extras,
    },
  },
  "/funnels/preview": { range, steps: [{ stepOrder: 1, stepLabel: "Catalog", value: 9, ...extras }] },
};

const scope = { tenantId, sourceId, period: { startDate: "2026-04-01", endDate: "2026-04-07" }, timezone: "Europe/Berlin" };
const definition = { steps: [{ stepOrder: 1, stepType: "page", stepValue: "/catalog" }, { stepOrder: 2, stepType: "event", stepValue: "purchase" }], breakdowns: [] };
type Data = Record<string, any>;
type Upstream = Record<string, any>;
const pick = (row: Upstream, keys: string[]) => Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));

export type EnvelopeCase = {
  tool: string;
  args: Record<string, unknown>;
  upstream: string;
  expected: (upstream: Upstream) => unknown;
  actual: (data: Data) => unknown;
};

const passthrough = (tool: string, args: Record<string, unknown>, upstream: string): EnvelopeCase =>
  ({ tool, args, upstream, expected: (u) => u, actual: (d) => d.report });

export const envelopeCases: EnvelopeCase[] = [
  { tool: "get_context", args: {}, upstream: "/workspace/access", expected: (u) => u.tenants, actual: (d) => d.tenants },
  passthrough("get_overview", scope, "/reports/overview"),
  { tool: "get_overview", args: { tenantId, report: "realtime" }, upstream: "/reports/realtime",
    expected: (u) => pick(u, ["windowMinutes", "consentedVisitors", "sessions", "events"]), actual: (d) => d.report },
  passthrough("get_overview", { ...scope, report: "pages" }, "/reports/pages/metrics"),
  passthrough("get_overview", { ...scope, report: "page_trends", pagePaths: ["/catalog"] }, "/reports/pages/time-series"),
  passthrough("get_overview", { ...scope, report: "sessions" }, "/reports/sessions/metrics"),
  passthrough("get_overview", { ...scope, report: "commerce" }, "/reports/commerce"),
  passthrough("get_overview", { ...scope, report: "ai_visibility" }, "/reports/ai-visibility"),
  { tool: "get_breakdown", args: { ...scope, report: "overview", dimension: "browsers" }, upstream: "/reports/overview",
    expected: (u) => u.sessionBreakdowns.browsers, actual: (d) => d.report.rows },
  { tool: "get_breakdown", args: { ...scope, report: "overview", dimension: "pages" }, upstream: "/reports/overview",
    expected: (u) => u.pages, actual: (d) => d.report.rows },
  passthrough("get_breakdown", { ...scope, dimension: "acquisition" }, "/reports/acquisition"),
  passthrough("get_breakdown", { ...scope, dimension: "pages" }, "/reports/pages/top"),
  { tool: "get_breakdown", args: { ...scope, report: "pages", dimension: "top" }, upstream: "/reports/pages/top", expected: (u) => u.rows, actual: (d) => d.report.rows },
  { tool: "get_breakdown", args: { ...scope, report: "pages", dimension: "attribution" }, upstream: "/reports/pages/top", expected: (u) => u.attributionRows, actual: (d) => d.report.rows },
  { tool: "get_breakdown", args: { ...scope, report: "pages", dimension: "entry" }, upstream: "/reports/pages/entry-exit", expected: (u) => u.entryPages, actual: (d) => d.report.rows },
  passthrough("get_breakdown", { ...scope, report: "pages", dimension: "flow", destinationPath: "/catalog" }, "/reports/pages/flow"),
  { tool: "get_breakdown", args: { ...scope, report: "ai_visibility", dimension: "pagePath" }, upstream: "/reports/ai-visibility/graphs",
    expected: (u) => u.points.map((point: Upstream) => pick(point, ["date", "visits", "categoryValue"])), actual: (d) => d.report.points },
  { tool: "get_breakdown", args: { ...scope, report: "ai_visibility", dimension: "pageAgent" }, upstream: "/reports/ai-visibility/page-report", expected: (u) => u.rows, actual: (d) => d.report.rows },
  passthrough("get_breakdown", { ...scope, dimension: "events" }, "/reports/events/overview"),
  { tool: "get_breakdown", args: { ...scope, mode: "options", target: "ai_visibility", dimension: "agentName" }, upstream: "/reports/ai-visibility/filter-options", expected: (u) => u.options, actual: (d) => d.report.items },
  { tool: "get_breakdown", args: { ...scope, mode: "options", target: "funnel_pages" }, upstream: "/funnels/options/pages", expected: (u) => u.items, actual: (d) => d.report.items },
  { tool: "get_breakdown", args: { tenantId, mode: "options", target: "funnel_breakdowns" }, upstream: "/funnels/options/breakdowns", expected: (u) => u.items, actual: (d) => d.report.items },
  { tool: "compare_periods", args: { ...scope, comparison: { mode: "previous_period" } }, upstream: "/reports/overview", expected: (u) => u, actual: (d) => d.current.report },
  passthrough("get_events", scope, "/reports/events/overview"),
  { tool: "get_events", args: { ...scope, mode: "options", target: "acquisition" }, upstream: "/reports/acquisition/event-options", expected: (u) => u.items, actual: (d) => d.report.items },
  { tool: "get_events", args: { tenantId, mode: "options", target: "funnel" }, upstream: "/funnels/options/events", expected: (u) => u.items, actual: (d) => d.report.items },
  { tool: "get_funnels", args: { tenantId }, upstream: "/funnels", expected: (u) => u, actual: (d) => d.funnels },
  passthrough("get_funnels", { tenantId, mode: "metadata", funnelId }, `/funnels/${funnelId}`),
  passthrough("get_funnels", { tenantId, period: scope.period, funnelId }, `/funnels/${funnelId}/summary`),
  { tool: "get_funnels", args: { tenantId, period: scope.period, funnelId, breakdown: { keys: ["source"] } }, upstream: `/funnels/${funnelId}/breakdown`,
    expected: (u) => u.breakdownTable, actual: (d) => d.report.breakdown },
  { tool: "get_funnels", args: { ...scope, mode: "preview", definition }, upstream: "/funnels/preview",
    expected: (u) => u.steps.map((step: Upstream) => pick(step, ["stepOrder", "stepLabel", "value"])), actual: (d) => d.report.steps },
];
