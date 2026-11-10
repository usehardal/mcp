import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequests } from "../reports/client";
import { buildReportQuery, filtersLine, reportScopeInput } from "./shared";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD");

export function registerComparePeriodsTool(server: McpServer) {
  server.registerTool(
    "compare_periods",
    {
      title: "Compare two Hardal periods",
      description:
        "Compare a tenant's overview between two date ranges, for questions like 'this month vs last month'. Returns the aggregate overview for each period so the two can be compared. Returns aggregate data only.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        ...reportScopeInput,
        timezone: z.string().optional().describe("IANA timezone. Defaults to Europe/Istanbul."),
        currentStart: dateString.describe("Start of the current period."),
        currentEnd: dateString.describe("End of the current period."),
        previousStart: dateString.describe("Start of the comparison period."),
        previousEnd: dateString.describe("End of the comparison period."),
      },
    },
    async (input, extra) => {
      const base = {
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        timezone: input.timezone,
        timeframe: "custom",
      };
      const current = buildReportQuery({ ...base, startDate: input.currentStart, endDate: input.currentEnd });
      const previous = buildReportQuery({ ...base, startDate: input.previousStart, endDate: input.previousEnd });

      const [currentReport, previousReport] = await reportsApiRequests<unknown>(extra.authInfo, [
        { path: "/reports/overview", query: current.query },
        { path: "/reports/overview", query: previous.query },
      ]);

      return {
        content: [
          {
            type: "text",
            text: `Current — ${filtersLine(current.filters)}\nPrevious — ${filtersLine(previous.filters)}`,
          },
        ],
        structuredContent: {
          current: { appliedFilters: current.filters, report: currentReport.data },
          previous: { appliedFilters: previous.filters, report: previousReport.data },
        },
      };
    },
  );
}
