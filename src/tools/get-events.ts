import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";
import {
  buildReportQuery,
  filtersLine,
  reportScopeInput,
  requireToken,
  timeRangeInput,
} from "./shared";

export function registerGetEventsTool(server: McpServer) {
  server.registerTool(
    "get_events",
    {
      title: "Hardal event counts",
      description:
        "Which events fire for a tenant over a date range and how often, with per-event counts, sessions and visitors. Use for questions about specific events or conversions. Returns aggregate data only.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: { ...reportScopeInput, ...timeRangeInput },
    },
    async (input, extra) => {
      const token = requireToken(extra);
      const { query, filters } = buildReportQuery(input);
      const { data } = await reportsApiRequest<unknown>(token, "/reports/events/overview", query);
      return {
        content: [{ type: "text", text: filtersLine(filters) }],
        structuredContent: { appliedFilters: filters, report: data },
      };
    },
  );
}
