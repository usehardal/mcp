import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest, reportsApiRequests } from "../reports/client";
import { calendarKeys, calendarQuery, pickFields, rejectUnsupported, scopeKeys } from "./report-arguments";
import { pageRows, reportResult, reportRows, toolResult, type ReportRow } from "./report-result";
import { funnelsInput } from "./get-funnels-input";

export function registerGetFunnelsTool(server: McpServer) {
  server.registerTool(
    "get_funnels",
    {
      title: "Hardal funnels",
      description: "List saved funnels, get funnel metadata, summarize or break down a saved funnel, or preview a definition without saving it.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: funnelsInput,
    },
    async ({ mode: requestedMode, funnelId, ...input }, extra) => {
      const mode = requestedMode ?? (funnelId ? "saved" : "list");
      const { tenantId, sourceId, limit, offset, breakdown, definition } = input;
      if (mode === "list") {
        rejectUnsupported(input, [...scopeKeys, "limit", "offset"], "the funnel catalog");
        if (funnelId) throw new Error("invalid-arguments: Use metadata or saved mode with funnelId.");
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, "/funnels", {
          tenantId, ...(sourceId ? { sourceId } : {}),
        });
        if (requestedMode || limit !== undefined || offset !== undefined) {
          const items = reportRows(data.items);
          const report = pageRows(items, limit, offset, data.total === items.length);
          return toolResult("Saved funnels for the authorized tenant.", {
            funnels: { items: report.rows, pagination: report.pagination },
          });
        }
        return toolResult("Saved funnels for the authorized tenant.", { funnels: data });
      }

      if (mode === "preview") {
        rejectUnsupported(input, [...calendarKeys, "definition"], "funnel preview");
        if (funnelId || !definition) throw new Error("invalid-arguments: Preview requires a definition.");
        const { query, filters } = calendarQuery(input);
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, {
          method: "POST",
          path: "/funnels/preview",
          query,
          body: {
            steps: definition.steps,
            breakdowns: definition.breakdowns.map((item) => ({ ...item, breakdownLabel: item.breakdownLabel ?? item.breakdownKey })),
          },
        });
        const steps = reportRows(data.steps).map((step) => pickFields(step, ["stepOrder", "stepLabel", "value"]));
        return reportResult({ steps }, { filters, fields: { mode } });
      }

      if (!funnelId) throw new Error("invalid-arguments: Provide a saved funnelId.");
      const path = `/funnels/${encodeURIComponent(funnelId)}`;
      if (mode === "metadata") {
        rejectUnsupported(input, ["tenantId"], "saved funnel metadata");
        const { data } = await reportsApiRequest<ReportRow>(extra.authInfo, path, { tenantId });
        return reportResult(data, { fields: { mode, funnelId } });
      }

      if (sourceId) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: "A funnel summary always uses the source saved with the funnel. Remove sourceId and request the funnel again.",
          }],
        };
      }
      rejectUnsupported(input, [...calendarKeys, "breakdown"], "saved funnel analysis");
      const { query, filters } = calendarQuery(input);
      const summaryPath = `${path}/summary`;
      let data: ReportRow;
      if (breakdown) {
        if ((breakdown.sortBy === "stepCount") !== (breakdown.sortStep !== undefined)) {
          throw new Error("invalid-arguments: Provide sortStep only when sorting by stepCount.");
        }
        const [summary, detail] = await reportsApiRequests<ReportRow>(extra.authInfo, [
          { path: summaryPath, query },
          {
            path: `${path}/breakdown`,
            query: {
              ...query,
              breakdownLimit: breakdown.limit ?? 10,
              breakdownOffset: breakdown.offset ?? 0,
              breakdownSearch: breakdown.search,
              breakdownSortBy: breakdown.sortBy,
              breakdownSortStep: breakdown.sortStep,
              breakdownSortDirection: breakdown.sortDirection,
              breakdownKeys: breakdown.keys?.length ? breakdown.keys.join(",") : undefined,
            },
          },
        ]);
        if (!summary || !detail) throw new Error("upstream-contract-mismatch: Missing funnel analysis.");
        data = { ...summary.data, breakdown: detail.data.breakdownTable };
      } else {
        ({ data } = await reportsApiRequest<ReportRow>(extra.authInfo, summaryPath, query));
      }
      return reportResult(data, {
        text: `Funnel summary — range: ${filters.range}, timezone: ${filters.timezone}, source: the funnel's own saved source. Aggregate data only.`,
        fields: { funnelId, appliedFilters: { range: filters.range, timezone: filters.timezone, source: "funnel-defined" } },
      });
    },
  );
}
