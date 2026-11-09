import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";
import {
  buildReportQuery,
  filtersLine,
  reportScopeInput,
  requireToken,
  timeRangeInput,
  trafficScopeInput,
} from "./shared";

const DIMENSION_PATHS: Record<string, string> = {
  acquisition: "/reports/acquisition",
  pages: "/reports/pages/top",
  events: "/reports/events/overview",
};

export function registerGetBreakdownTool(server: McpServer) {
  server.registerTool(
    "get_breakdown",
    {
      title: "Hardal breakdown by dimension",
      description:
        "Break a tenant's traffic down by one dimension over a date range: acquisition (channels, sources, campaigns), pages (top pages), or events (event names). Use when the question is 'by source', 'top pages' or 'which events'. Returns aggregate data only.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        dimension: z
          .enum(["acquisition", "pages", "events"])
          .describe("What to break the traffic down by."),
        ...reportScopeInput,
        ...timeRangeInput,
        trafficScope: trafficScopeInput,
      },
    },
    async ({ dimension, trafficScope, ...input }, extra) => {
      const token = requireToken(extra);
      const options =
        dimension === "acquisition" ? { trafficScope: trafficScope ?? "all_traffic" } : undefined;
      const { query, filters } = buildReportQuery(input, options);
      const { data } = await reportsApiRequest<unknown>(token, DIMENSION_PATHS[dimension]!, query);
      return {
        content: [{ type: "text", text: `${dimension} breakdown. ${filtersLine(filters)}` }],
        structuredContent: { dimension, appliedFilters: filters, report: data },
      };
    },
  );
}
