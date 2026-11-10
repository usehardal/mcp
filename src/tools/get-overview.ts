import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest, reportsApiRequests, type ReportRequest } from "../reports/client";
import {
  calendarKeys, calendarQuery, pickFields, rejectUnsupported, scopeKeys, validatePointBudget,
} from "./report-arguments";
import { aiFilters, overviewFilterFields } from "./report-filters";
import { reportResult, reportRows, type ReportRow } from "./report-result";

import { overviewInput } from "./get-overview-input";

const defaultPageTrendPaths = 5;

const inputFields = {
  overview: ["interval", "filters"],
  pages: [],
  page_trends: ["interval", "pagePaths", "pagePathLimit", "pagePathOffset"],
  sessions: ["interval", "includeTrend", "engagedEventNames"],
  commerce: ["interval"],
  ai_visibility: ["interval", "includeTrend", "filters"],
};

export function registerGetOverviewTool(server: McpServer) {
  server.registerTool(
    "get_overview",
    {
      title: "Hardal analytics overview",
      description: "Overview, rolling Realtime, Pages metrics and trends, aggregate Sessions, Commerce or AI Visibility.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: overviewInput,
    },
    async ({ report = "overview", ...input }, extra) => {
      if (report === "realtime") {
        rejectUnsupported(input, [...scopeKeys, "windowMinutes"], report);
        const { tenantId, sourceId, windowMinutes = 5 } = input;
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, "/reports/realtime", { tenantId, sourceId, windowMinutes });
        return reportResult(pickFields(data, ["windowMinutes", "consentedVisitors", "sessions", "events"]), {
          text: `Realtime — last ${windowMinutes} minutes, source: ${sourceId ?? "all"}.`,
          fields: { timeBasis: "rolling_window", range: null, window: { asOf: new Date().toISOString(), windowMinutes } },
        });
      }

      rejectUnsupported(input, [...calendarKeys, ...inputFields[report]], report);
      rejectUnsupported(input.filters, Object.keys(report === "ai_visibility" ? aiFilters.shape : overviewFilterFields), report);
      const { query, filters, range } = calendarQuery(input);
      const { interval = "day", includeTrend, engagedEventNames } = input;
      if (input.interval && includeTrend === false) throw new Error("unsupported-filter: interval requires a trend.");
      const catalogOnly = report === "page_trends" && !input.pagePaths && (input.pagePathOffset ?? 0) > 0;
      if (report !== "pages" && includeTrend !== false && !catalogOnly) {
        const seriesCount = report === "page_trends"
          ? input.pagePaths?.length ?? Math.min(input.pagePathLimit ?? defaultPageTrendPaths, defaultPageTrendPaths)
          : 1;
        validatePointBudget(range, interval, seriesCount);
      }

      const request = (path: string, options?: typeof query): ReportRequest => ({ path, query: { ...query, ...options } });
      let requests: ReportRequest[];
      switch (report) {
        case "overview":
          requests = [request("/reports/overview", { interval, ...input.filters })];
          break;
        case "pages":
          requests = [request("/reports/pages/metrics")];
          break;
        case "page_trends":
          requests = [{
            method: "POST",
            path: "/reports/pages/time-series",
            query: {
              ...query,
              interval: catalogOnly ? "day" : interval,
              pagePathLimit: input.pagePathLimit ?? 20,
              pagePathOffset: input.pagePathOffset,
            },
            body: input.pagePaths ? { pagePaths: input.pagePaths } : {},
          }];
          break;
        case "sessions":
          requests = [request("/reports/sessions/metrics", { engagedEventNames })];
          if (includeTrend !== false) requests.push(request("/reports/sessions/trends", { interval, engagedEventNames }));
          break;
        case "commerce":
          requests = [request("/reports/commerce", { interval })];
          break;
        case "ai_visibility": {
          const aiQuery = aiFilters.parse(input.filters ?? {});
          requests = [request("/reports/ai-visibility", aiQuery)];
          if (includeTrend !== false) requests.push(request("/reports/ai-visibility/graphs", { interval, ...aiQuery }));
          break;
        }
      }

      const [primary, secondary] = requests.length === 1
        ? [await reportsApiRequest<ReportRow>(extra.authInfo, requests[0]!)]
        : await reportsApiRequests<ReportRow>(extra.authInfo, requests);
      if (!primary) throw new Error("upstream-contract-mismatch: Missing report.");
      const data = primary.data;
      const output = secondary
        ? { ...data, series: reportRows(secondary.data.series ?? secondary.data.points) }
        : data;
      const series = output.series ?? output.timeSeries ?? output.trend;
      if (Array.isArray(series) && series.length > 2000) {
        throw new Error("response-too-large: Choose a coarser interval or a shorter date range.");
      }
      return reportResult(output, { filters, ...(report !== "overview" ? { fields: { reportType: report } } : {}) });
    },
  );
}
