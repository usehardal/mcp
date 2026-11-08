import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { reportsApiRequest } from "../reports/client";

type WorkspaceSource = { id: string; name: string; domain: string | null };

type WorkspaceTenant = {
  id: string;
  name: string;
  reportType: string;
  reportingCurrency: string;
  organization: { id: string; name: string };
  sources: WorkspaceSource[];
};

type WorkspacePage = { tenants: WorkspaceTenant[] };

type WorkspaceMeta = { total: number; limit: number; offset: number; hasNext: boolean };

function summarize(tenants: WorkspaceTenant[], meta: WorkspaceMeta): string {
  if (tenants.length === 0) {
    return "You have no tenants you can query. Ask the user to grant access on the Hardal consent screen.";
  }
  const lines = tenants.map((tenant) => {
    const sources = tenant.sources.map((source) => source.name).join(", ") || "no sources";
    return `- ${tenant.name} (${tenant.organization.name}, ${tenant.reportType}, ${tenant.reportingCurrency}) — sources: ${sources} — tenantId: ${tenant.id}`;
  });
  const more = meta.hasNext ? `\nMore tenants available: request offset ${meta.offset + meta.limit}.` : "";
  return `Authorized tenants (${meta.total} total). Pass the tenantId of the one the question is about to the report tools.\n${lines.join("\n")}${more}`;
}

export function registerGetContextTool(server: McpServer) {
  server.registerTool(
    "get_context",
    {
      title: "List authorized Hardal workspaces",
      description:
        "List the organizations, tenants and sources this user can query, with each tenant's report type and reporting currency. Call this first and pick the right tenantId before calling any report tool. Returns aggregate workspace metadata only, never visitor-level data.",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe("Max tenants per page. Defaults to 50."),
        offset: z.number().int().min(0).optional().describe("Number of tenants to skip for paging."),
      },
    },
    async ({ limit, offset }, extra) => {
      const token = extra.authInfo?.token;
      if (!token) {
        throw new Error("missing authenticated token");
      }

      const { data, meta } = await reportsApiRequest<WorkspacePage>(token, "/workspace/access", {
        limit,
        offset,
      });
      const pagination = (meta ?? { total: data.tenants.length, limit: data.tenants.length, offset: 0, hasNext: false }) as WorkspaceMeta;

      return {
        content: [{ type: "text", text: summarize(data.tenants, pagination) }],
        structuredContent: { tenants: data.tenants, pagination },
      };
    },
  );
}
