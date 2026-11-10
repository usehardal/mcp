import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequests } from "../reports/client";
import { buildReportQuery, filtersLine } from "./shared";
import {
  calendarDays, rejectUnsupported, resolveCalendar,
  shiftDays, validateRange, type CalendarRange,
} from "./report-arguments";
import {
  acquisitionFilterFields, acquisitionFilters, acquisitionQuery, overviewFilterFields, overviewFilters,
} from "./report-filters";
import { toolResult, type ReportRow } from "./report-result";

import { compareInput, type ComparisonInput } from "./compare-periods-input";

const reportMetrics = {
  overview: ["consentedVisitors", "sessions", "pageViews", "bounceRate", "sessionDuration", "totalEvents", "consentRate"],
  acquisition: ["consentedVisitors", "sessions", "conversions", "sessionDuration", "revenue"],
};

function previousYear(date: string): string {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCFullYear(year! - 1);
  if (shifted.getUTCMonth() + 1 !== month) shifted.setUTCDate(0);
  return shifted.toISOString().slice(0, 10);
}

function comparisonRange(current: CalendarRange, comparison: ComparisonInput): CalendarRange {
  if ("startDate" in comparison) return validateRange(comparison);
  if (comparison.mode === "previous_year") {
    return { startDate: previousYear(current.startDate), endDate: previousYear(current.endDate) };
  }
  return { startDate: shiftDays(current.startDate, -calendarDays(current)), endDate: shiftDays(current.startDate, -1) };
}

function metricValue(value: unknown): number | null {
  const number = typeof value === "object" && value !== null && "value" in value ? value.value : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}

export function registerComparePeriodsTool(server: McpServer) {
  server.registerTool(
    "compare_periods",
    {
      title: "Compare two Hardal periods",
      description: "Compare Overview or Acquisition by calendar period and calculate absolute and relative changes.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: compareInput,
    },
    async ({ report = "overview", filters, ...input }, extra) => {
      const { currentStart, currentEnd, previousStart, previousEnd, period, comparison } = input;
      const legacyDates = currentStart !== undefined || currentEnd !== undefined || previousStart !== undefined || previousEnd !== undefined;
      if (legacyDates && (period || comparison)) throw new Error("invalid-arguments: Use period and comparison or the four date fields.");
      let currentRange: CalendarRange;
      let previousRange: CalendarRange;
      if (legacyDates) {
        if (!currentStart || !currentEnd || !previousStart || !previousEnd) {
          throw new Error("invalid-date-range: Supply all four comparison dates.");
        }
        currentRange = resolveCalendar({ ...input, startDate: currentStart, endDate: currentEnd });
        previousRange = validateRange({ startDate: previousStart, endDate: previousEnd });
      } else {
        if (!period || !comparison) throw new Error("invalid-arguments: Supply period and comparison.");
        currentRange = resolveCalendar(input);
        previousRange = validateRange(comparisonRange(currentRange, comparison));
      }

      const allowedFilters = report === "acquisition" ? Object.keys(acquisitionFilterFields) : Object.keys(overviewFilterFields);
      rejectUnsupported(filters, allowedFilters, `${report} period comparison`);
      const acquisition = report === "acquisition" ? acquisitionFilters.parse(filters ?? {}) : undefined;
      const forwarded = acquisition ? acquisitionQuery(acquisition) : overviewFilters.parse(filters ?? {});
      const current = buildReportQuery({ ...input, ...currentRange, timeframe: "custom" }, acquisition);
      const previous = buildReportQuery({ ...input, ...previousRange, timeframe: "custom" }, acquisition);

      const [currentReport, previousReport] = await reportsApiRequests<ReportRow>(extra.authInfo, [
        { path: `/reports/${report}`, query: { ...current.query, interval: "day", ...forwarded } },
        { path: `/reports/${report}`, query: { ...previous.query, interval: "day", ...forwarded } },
      ]);
      if (!currentReport || !previousReport) throw new Error("upstream-contract-mismatch: Missing comparison report.");
      const currentScores = currentReport.data.scoreCards as ReportRow | undefined;
      const previousScores = previousReport.data.scoreCards as ReportRow | undefined;
      const metrics = Object.fromEntries(reportMetrics[report].map((name) => {
        const currentValue = metricValue(currentScores?.[name]);
        const previousValue = metricValue(previousScores?.[name]);
        const absoluteChange = currentValue === null || previousValue === null ? null : currentValue - previousValue;
        const relativeChangePercent = absoluteChange === null || !previousValue ? null : absoluteChange / previousValue * 100;
        return [name, {
          current: currentValue, previous: previousValue, absoluteChange, relativeChangePercent,
          ...(relativeChangePercent === null ? { reason: absoluteChange === null ? "value-unavailable" : "previous-zero" } : {}),
        }];
      }));

      return toolResult(
        `Current — ${filtersLine(current.filters)}\nPrevious — ${filtersLine(previous.filters)}`,
        {
          report, metrics,
          current: { appliedFilters: current.filters, report: currentReport.data },
          previous: { appliedFilters: previous.filters, report: previousReport.data },
        },
      );
    },
  );
}
