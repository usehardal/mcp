import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";
import {
  buildReportQuery,
  filtersLine,
  reportScopeInput,
  requireToken,
  timeRangeInput,
} from "./shared";

export function registerGetOverviewTool(server: McpServer) {
  server.registerTool(
    "get_overview",
    {
      title: "Hardal analytics overview",
      description:
        "Aggregated overview for a tenant and date range: visitor, session and page-view totals, bounce and consent rates, top pages, referrers and locations, and a time series. The best starting point for a 'what happened' question. Returns aggregate data only.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: { ...reportScopeInput, ...timeRangeInput },
    },
    async (input, extra) => {
      const token = requireToken(extra);
      const { query, filters } = buildReportQuery(input);
      const { data } = await reportsApiRequest<unknown>(token, "/reports/overview", query);
      return {
        content: [{ type: "text", text: filtersLine(filters) }],
        structuredContent: { appliedFilters: filters, report: data },
      };
    },
  );
}
