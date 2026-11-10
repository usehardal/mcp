import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";
import { DEFAULT_TIMEZONE } from "./shared";
import {
  calendarKeys, calendarQuery, rejectUnsupported, scopeKeys, validatePointBudget,
} from "./report-arguments";
import { pageRows, pagination, reportResult, reportRows, type ReportRow } from "./report-result";

import { eventInput } from "./get-events-input";

const optionPaths = {
  acquisition: "/reports/acquisition/event-options",
  commerce: "/reports/commerce/event-options",
  funnel: "/funnels/options/events",
};

export function registerGetEventsTool(server: McpServer) {
  server.registerTool(
    "get_events",
    {
      title: "Hardal event counts",
      description: "Aggregate event metrics and timeline, or event options for acquisition, commerce or funnels.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: eventInput,
    },
    async ({ mode = "overview", ...input }, extra) => {
      if (mode === "options") {
        const { target, search, limit = 20, offset = 0 } = input;
        if (!target) throw new Error("invalid-arguments: Event options require a target.");
        const catalog = target === "funnel";
        rejectUnsupported(input, [
          ...(catalog ? [...scopeKeys, "timezone"] : calendarKeys),
          "target", "limit", "offset", ...(target !== "commerce" ? ["search"] : []),
        ], `${target} event options`);
        const calendar = catalog ? undefined : calendarQuery(input);
        const query = calendar?.query ?? {
          tenantId: input.tenantId, sourceId: input.sourceId, timezone: input.timezone ?? DEFAULT_TIMEZONE,
        };
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, optionPaths[target], {
          ...query, search, ...(catalog ? {} : { limit, offset }),
        });
        const items = reportRows(data.items);
        const page = catalog
          ? pageRows(items, limit, offset, false)
          : { rows: items.slice(0, limit), pagination: pagination(limit, offset, Math.min(items.length, limit), null) };
        return reportResult({ items: page.rows, pagination: page.pagination }, {
          filters: calendar?.filters,
          fields: { mode, target, ...(catalog ? { timeBasis: "catalog" } : {}) },
        });
      }

      rejectUnsupported(input, [
        ...calendarKeys, "interval", "metricEventNames", "conversionEventNames", "timeline", "metricsOnly", "limit", "offset",
      ], "events overview");
      const { query, filters, range } = calendarQuery(input);
      const { interval = "day", metricEventNames, conversionEventNames, timeline, metricsOnly } = input;
      if (metricsOnly && timeline?.eventNames.length) throw new Error("unsupported-filter: Timeline selection requires metricsOnly to be false.");
      if (!metricsOnly) {
        validatePointBudget(range, interval);
      }
      const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, "/reports/events/overview", {
        ...query, interval, metricEventNames, conversionEventNames, metricsOnly,
        timelineOptionMode: timeline?.eventNames.length ? timeline.mode : undefined,
        timelineEventNames: timeline?.eventNames,
      });
      if (Array.isArray(data.timeline) && data.timeline.length > 2000) {
        throw new Error("response-too-large: Choose a coarser interval or a shorter date range.");
      }
      if (input.limit === undefined && input.offset === undefined) return reportResult(data, { filters });
      const page = pageRows(reportRows(data.timelineEventOptions), input.limit, input.offset, false);
      return reportResult({ ...data, timelineEventOptions: page.rows, pagination: page.pagination }, { filters });
    },
  );
}
