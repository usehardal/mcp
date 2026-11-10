import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";
import { buildReportQuery, reportScopeInput, timeRangeInput } from "./shared";

export function registerGetFunnelsTool(server: McpServer) {
  server.registerTool(
    "get_funnels",
    {
      title: "Hardal funnels",
      description:
        "List a tenant's saved funnels, or get one funnel's conversion summary over a date range when funnelId is given. Use for questions about conversion funnels. Returns aggregate data only.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        ...reportScopeInput,
        ...timeRangeInput,
        funnelId: z
          .string()
          .uuid()
          .optional()
          .describe("Funnel to summarize. Omit to list the tenant's funnels."),
      },
    },
    async ({ funnelId, ...input }, extra) => {
      if (!funnelId) {
        const { data } = await reportsApiRequest<unknown>(extra.authInfo, "/funnels", {
          tenantId: input.tenantId,
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        });
        return {
          content: [{ type: "text", text: `Funnels for tenant ${input.tenantId}. Aggregate data only.` }],
          structuredContent: { funnels: data },
        };
      }

      if (input.sourceId) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "A funnel summary always uses the source saved with the funnel; a sourceId override is not supported. Remove sourceId and request the funnel again.",
            },
          ],
        };
      }

      const { query, filters } = buildReportQuery(input);
      const { data } = await reportsApiRequest<unknown>(
        extra.authInfo,
        `/funnels/${encodeURIComponent(funnelId)}/summary`,
        query,
      );
      return {
        content: [
          {
            type: "text",
            text: `Funnel summary — range: ${filters.range}, timezone: ${filters.timezone}, source: the funnel's own saved source. Aggregate data only.`,
          },
        ],
        structuredContent: {
          funnelId,
          appliedFilters: { range: filters.range, timezone: filters.timezone, source: "funnel-defined" },
          report: data,
        },
      };
    },
  );
}
