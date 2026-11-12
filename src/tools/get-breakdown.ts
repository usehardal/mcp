import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest, type ReportsQuery } from "../reports/client";
import { commerceBreakdown } from "./commerce-breakdown";
import { aiGraphDimensions, breakdownInput, type BreakdownInput } from "./get-breakdown-input";
import {
  calendarKeys, calendarQuery, pickFields, rejectUnsupported, validatePointBudget,
} from "./report-arguments";
import {
  acquisitionDistributionFields, acquisitionFilters, acquisitionSortFields, aiFilterFields, aiFilters, aiPageReportFilters,
  acquisitionQuery, overviewFilterFields, overviewFilters,
} from "./report-filters";
import { extendPagination, pageRows, pagination, reportRows, type ReportRow } from "./report-result";
import { catalogScope } from "./output/context";
import { guard, reportResult } from "./output/result";
import { reportOutput } from "./output/tool-outputs";

const pagedKeys = [...calendarKeys, "limit", "offset"];
const aiFilterDimensions = ["agentType", ...aiGraphDimensions];
const overviewRows = {
  channels: ["acquisitionBreakdowns", "channels"],
  sources: ["acquisitionBreakdowns", "sources"],
  countries: ["locations", "countries"],
  cities: ["locations", "cities"],
  devices: ["sessionBreakdowns", "devices"],
  browsers: ["sessionBreakdowns", "browsers"],
  operating_systems: ["sessionBreakdowns", "operatingSystems"],
  pages: ["pages"],
};

function pathValue(data: ReportRow, fields: string[]): unknown {
  return fields.reduce<unknown>((parent, key) => (parent as ReportRow | undefined)?.[key], data);
}

async function options(input: BreakdownInput, authInfo: AuthInfo | undefined) {
  const { target, dimension, search, limit = 20, offset = 0 } = input;
  const extra = { mode: "options", target, dimension };
  if (target === "funnel_breakdowns") {
    rejectUnsupported(input, ["tenantId", "target"], target);
    const { data } = await reportsApiRequest<ReportRow>(authInfo, "/funnels/options/breakdowns", { tenantId: input.tenantId });
    const items = reportRows(data.items);
    return reportResult({ items }, { scope: catalogScope(input), fields: extra, context: { returnedRows: items.length } });
  }
  if (target !== "ai_visibility" && target !== "funnel_pages") {
    throw new Error("invalid-arguments: Select an options target.");
  }
  const ai = target === "ai_visibility";
  rejectUnsupported(input, [...pagedKeys, "target", "search", ...(ai ? ["dimension", "filters"] : [])], target);
  if (ai && (!dimension || !aiFilterDimensions.includes(dimension as (typeof aiFilterDimensions)[number]))) {
    throw new Error("invalid-arguments: Select an AI filter dimension.");
  }
  rejectUnsupported(input.filters, ai ? Object.keys(aiFilterFields) : [], target);
  const upstreamLimit = Math.min(limit + offset, 500);
  if (ai && offset >= 500) throw new Error("invalid-pagination: AI filter options have a 500-row catalog limit.");
  const { query, filters, scope } = calendarQuery(input);
  const { data } = await reportsApiRequest<ReportRow>(authInfo,
    ai ? "/reports/ai-visibility/filter-options" : "/funnels/options/pages",
    { ...query, search, ...(ai ? { dimension, limit: upstreamLimit, ...aiFilters.parse(input.filters ?? {}) } : { limit, offset }) },
  );
  const rows = reportRows(ai ? data.options : data.items);
  const page = ai
    ? pageRows(rows, limit, offset, rows.length < upstreamLimit)
    : { rows: rows.slice(0, limit), pagination: pagination(limit, offset, Math.min(rows.length, limit), null) };
  return reportResult({ items: page.rows, pagination: page.pagination }, {
    scope, filters, fields: extra, context: { applied: { search, dimension: ai ? dimension : undefined }, pagination: page.pagination },
  });
}

async function acquisition(input: BreakdownInput, authInfo: AuthInfo | undefined) {
  rejectUnsupported(input, [
    ...pagedKeys, "dimension", "filters", "trafficScope", "interval", "groupBy", "columns", "sortBy", "sortEventMetricName", "sortDirection",
  ], "Acquisition");
  const supported = ["channels", "campaigns", "source", "medium"];
  const dimension = input.dimension === "acquisition" ? undefined : input.dimension;
  if (dimension && !supported.includes(dimension)) throw new Error("invalid-arguments: Unknown Acquisition breakdown dimension.");
  const selected = acquisitionFilters.parse(input.filters ?? {});
  if (input.trafficScope && selected.trafficScope && input.trafficScope !== selected.trafficScope) {
    throw new Error("invalid-arguments: Provide one Acquisition consent filter.");
  }
  const trafficScope = input.trafficScope ?? selected.trafficScope;
  const sortBy = input.sortBy === undefined ? undefined : acquisitionSortFields.parse(input.sortBy);
  const columns = input.columns?.map((column) => acquisitionSortFields.exclude(["event_metric"]).parse(column));
  if (columns && sortBy && sortBy !== "event_metric" && !columns.includes(sortBy)) {
    throw new Error("invalid-arguments: Include the Acquisition sort column in columns.");
  }
  if (sortBy === "event_metric" && (!input.sortEventMetricName || !selected.eventMetricNames?.includes(input.sortEventMetricName))) {
    throw new Error("invalid-arguments: Select the event metric to sort by in eventMetricNames.");
  }
  if (input.sortEventMetricName && sortBy !== "event_metric") {
    throw new Error("unsupported-filter: sortEventMetricName requires event_metric sorting.");
  }
  const { query, filters, range, scope } = calendarQuery(input);
  const { interval = "day", limit = 20, offset = 0, sortDirection, sortEventMetricName } = input;
  validatePointBudget(range, interval);
  const groupBy = input.groupBy === undefined || input.groupBy === "none"
    ? input.groupBy
    : acquisitionDistributionFields.parse(input.groupBy);
  const { data } = await reportsApiRequest<ReportRow>(authInfo, "/reports/acquisition", {
    ...query, ...acquisitionQuery(selected), interval, trafficScope,
    breakdownMode: dimension, groupBy, columns: columns?.join(","), limit, offset,
    sortBy, sortDirection, sortEventMetricName,
  });
  const controls = data.controls as ReportRow | undefined;
  const consent = typeof controls?.trafficScope === "string" ? controls.trafficScope : trafficScope;
  const distribution = data.trafficDistribution as ReportRow | undefined;
  const page = distribution
    ? extendPagination(distribution.pagination, reportRows(distribution.rows).length, { limit, offset })
    : undefined;
  const output = distribution ? { ...data, trafficDistribution: { ...distribution, pagination: page } } : data;
  return reportResult(output, {
    scope: { ...scope, filters: { ...scope.filters, consent } },
    filters: { ...filters, consent },
    fields: { dimension: input.dimension },
    context: {
      previousRange: data.previousRange, interval, currency: data.currency, pagination: page,
      applied: { ...selected, trafficScope: consent, groupBy, columns, sortBy, sortDirection, sortEventMetricName },
    },
  });
}

async function readBreakdown(
  report: "overview" | "pages" | "ai_visibility" | "events",
  dimension: string,
  input: BreakdownInput,
  authInfo: AuthInfo | undefined,
) {
  const { query, filters, range, scope } = calendarQuery(input);
  const { limit = 20, offset = 0 } = input;
  const fields = { reportType: report, dimension };
  let applied: Record<string, unknown> = {};
  let interval: string | null = null;
  const allowed = report === "overview" ? Object.keys(overviewFilterFields)
    : report === "ai_visibility" && dimension === "pageAgent" ? Object.keys(aiPageReportFilters.shape)
      : report === "ai_visibility" ? Object.keys(aiFilterFields) : [];
  rejectUnsupported(input.filters, allowed, `${report}/${dimension}`);
  let path: string;
  let params: ReportsQuery;
  let rows: string[] | undefined;
  let serverPaged = false;
  if (report === "overview") {
    rejectUnsupported(input, [...pagedKeys, "filters"], report);
    if (!Object.prototype.hasOwnProperty.call(overviewRows, dimension)) throw new Error("invalid-arguments: Unknown Overview breakdown.");
    path = "/reports/overview";
    applied = overviewFilters.parse(input.filters ?? {});
    params = { ...query, interval: "day", ...overviewFilters.parse(input.filters ?? {}) };
    rows = overviewRows[dimension as keyof typeof overviewRows];
  } else if (report === "pages") {
    switch (dimension) {
      case "top":
        rejectUnsupported(input, pagedKeys, "Pages");
        path = "/reports/pages/top";
        params = { ...query, limit, offset };
        rows = ["rows"];
        serverPaged = true;
        break;
      case "attribution":
        rejectUnsupported(input, [...pagedKeys, "pageLimit", "pageOffset"], "Pages attribution");
        path = "/reports/pages/top";
        params = { ...query, limit: input.pageLimit ?? 20, offset: input.pageOffset ?? 0 };
        rows = ["attributionRows"];
        break;
      case "entry":
      case "exit":
        rejectUnsupported(input, pagedKeys, "entry and exit pages");
        if (offset !== 0) throw new Error("invalid-pagination: Entry and exit pages require offset zero.");
        path = "/reports/pages/entry-exit";
        params = { ...query, limit: input.limit ?? 5 };
        rows = [dimension === "entry" ? "entryPages" : "exitPages"];
        break;
      case "flow":
        rejectUnsupported(input, [...calendarKeys, "limit", "steps", "destinationPath"], "Page Flow");
        path = "/reports/pages/flow";
        applied = { destinationPath: input.destinationPath, steps: input.steps ?? 2 };
        params = { ...query, steps: input.steps ?? 2, limit: input.limit ?? 50, destinationPath: input.destinationPath };
        break;
      default:
        throw new Error("invalid-arguments: Unknown Pages breakdown.");
    }
  } else if (report === "ai_visibility") {
    rejectUnsupported(input, [...pagedKeys, "filters", ...(dimension !== "pageAgent" ? ["interval"] : [])], "AI Visibility");
    if (dimension === "pageAgent") {
      path = "/reports/ai-visibility/page-report";
      applied = aiPageReportFilters.parse(input.filters ?? {});
      params = { ...query, ...aiPageReportFilters.parse(input.filters ?? {}) };
      rows = ["rows"];
    } else {
      if (!aiGraphDimensions.includes(dimension as (typeof aiGraphDimensions)[number])) {
        throw new Error("invalid-arguments: Unknown AI graph dimension.");
      }
      interval = input.interval ?? "day";
      validatePointBudget(range, input.interval ?? "day");
      path = "/reports/ai-visibility/graphs";
      applied = aiFilters.parse(input.filters ?? {});
      params = { ...query, ...aiFilters.parse(input.filters ?? {}), category: dimension, interval };
      rows = ["points"];
    }
  } else {
    rejectUnsupported(input, calendarKeys, "events");
    path = "/reports/events/overview";
    interval = "day";
    params = { ...query, interval };
  }

  const { data } = await reportsApiRequest<ReportRow>(authInfo, path, params);
  const context = { previousRange: data.previousRange, applied, interval };
  if (!rows) {
    if (dimension === "flow") {
      const edges = reportRows(data.edges);
      if (edges.length > 250) throw new Error("response-too-large: Select fewer steps or edges.");
      return reportResult({ ...data, returnedEdges: edges.length, limitPerStep: input.limit ?? 50 }, {
        scope, filters, fields, context: { ...context, returnedRows: edges.length },
      });
    }
    return reportResult(data, { scope, filters, fields, context });
  }
  const entries = reportRows(pathValue(data, rows));
  const effectiveLimit = dimension === "entry" || dimension === "exit" ? (input.limit ?? 5) : limit;
  const upstreamPage = data.pagination as ReportRow | undefined;
  const total = serverPaged && typeof upstreamPage?.total === "number" ? upstreamPage.total : null;
  if (rows[0] === "points") {
    if (entries.length > 2000) throw new Error("response-too-large: Use a coarser interval or shorter range.");
    const points = entries.map((entry) => pickFields(entry, ["date", "visits", "categoryValue"]));
    const categoryVisits = new Map<string, number | null>();
    for (const { categoryValue, visits } of points) {
      if (typeof categoryValue !== "string" || !categoryValue) continue;
      const current = categoryVisits.get(categoryValue);
      categoryVisits.set(categoryValue, typeof visits === "number" && current !== null ? (current ?? 0) + visits : null);
    }
    const categories = Array.from(categoryVisits, ([value, visits]) => ({ value, visits }));
    const page = pageRows(categories, limit, offset, false);
    return reportResult({ points, ...page }, { scope, filters, fields, context: { ...context, pagination: page.pagination } });
  }
  if (dimension === "attribution") {
    const topPagesLimit = input.pageLimit ?? 20;
    const topPagesOffset = input.pageOffset ?? 0;
    const topPagesTotal = typeof upstreamPage?.total === "number" ? upstreamPage.total : null;
    const topPagesPagination = pagination(topPagesLimit, topPagesOffset, reportRows(data.rows).length, topPagesTotal);
    const page = pageRows(entries, limit, offset, false);
    return reportResult({ ...page, topPagesPagination }, { scope, filters, fields, context: { ...context, pagination: page.pagination } });
  }
  const page = serverPaged
    ? { rows: entries.slice(0, effectiveLimit), pagination: pagination(effectiveLimit, offset, Math.min(entries.length, effectiveLimit), total) }
    : pageRows(entries, effectiveLimit, offset, false);
  return reportResult(page, { scope, filters, fields, context: { ...context, pagination: page.pagination } });
}

export function registerGetBreakdownTool(server: McpServer) {
  server.registerTool(
    "get_breakdown",
    {
      title: "Hardal breakdown by dimension",
      description: "Aggregate Overview, Acquisition, Pages, Commerce or AI Visibility breakdowns, or supported filter options.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: breakdownInput,
      outputSchema: reportOutput,
    },
    guard<typeof breakdownInput>(async ({ mode = "data", report: explicitReport, ...input }, extra) => {
      if (mode === "options") {
        if (explicitReport) throw new Error("unsupported-filter: Use target for discovery options.");
        return options(input, extra.authInfo);
      }
      const { dimension } = input;
      if (!dimension) throw new Error("invalid-arguments: Select a breakdown dimension.");
      const report = explicitReport ?? (dimension === "acquisition" || dimension === "pages" || dimension === "events" ? dimension : undefined);
      if (!report) throw new Error("invalid-arguments: Select the report for this dimension.");
      const fields = { ...input, dimension: undefined };
      if (report === "commerce") return commerceBreakdown(dimension, fields, extra.authInfo);
      if (report === "acquisition") return acquisition({ ...fields, dimension }, extra.authInfo);
      if (!explicitReport && report === "pages") {
        const { query, filters, scope } = calendarQuery(input);
        rejectUnsupported(fields, calendarKeys, "top pages");
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, "/reports/pages/top", query);
        const rows = reportRows(data.rows);
        const page = extendPagination(data.pagination, rows.length, { limit: rows.length, offset: 0 });
        return reportResult({ ...data, pagination: page }, {
          scope, filters, fields: { dimension }, context: { previousRange: data.previousRange, pagination: page },
        });
      }
      return readBreakdown(report, dimension, fields, extra.authInfo);
    }),
  );
}
