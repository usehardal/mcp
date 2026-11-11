import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as reportsClient from "../../src/reports/client";
import { registerGetContextTool } from "../../src/tools/get-context";

let requests: Mock<typeof reportsClient.reportsApiRequest>;

type Handler = (
  args: { limit?: number; offset?: number },
  extra: { authInfo?: AuthInfo },
) => Promise<{ content: Array<{ text: string }>; structuredContent: { tenants: Array<{ reportingCurrency: string | null }> } }>;

function contextHandler(): Handler {
  let captured: Handler | undefined;
  const server = {
    registerTool: (_name: string, _definition: unknown, handler: Handler) => {
      captured = handler;
    },
  } as unknown as McpServer;
  registerGetContextTool(server);
  if (!captured) throw new Error("get_context was not registered");
  return captured;
}

const extra = {
  authInfo: { token: "mcp-token", clientId: "mcp-client", scopes: ["reports:read"], extra: { userId: "user-1" } },
};

function tenant(name: string, reportType: string, reportingCurrency: string | null) {
  return {
    id: `${name}-id`,
    name,
    reportType,
    reportingCurrency,
    organization: { id: "organization-id", name: "Acme" },
    sources: [{ id: `${name}-source`, name: "Website", domain: null }],
  };
}

beforeEach(() => {
  requests = spyOn(reportsClient, "reportsApiRequest").mockResolvedValue({
    data: { tenants: [tenant("Store", "ecommerce", "USD"), tenant("Blog", "default", null)] },
    meta: { total: 2, limit: 50, offset: 0, hasNext: false },
  });
});

afterEach(() => {
  requests.mockRestore();
});

describe("get_context reporting currency", () => {
  it("names the currency when the tenant has one and leaves it out when it has none", async () => {
    const result = await contextHandler()({}, extra);
    const [summary] = result.content;

    expect(summary?.text).toContain("- Store (Acme, ecommerce, USD) — sources: Website");
    expect(summary?.text).toContain("- Blog (Acme, default) — sources: Website");
    expect(summary?.text).not.toContain("null");
    expect(result.structuredContent.tenants.map((entry) => entry.reportingCurrency)).toEqual(["USD", null]);
  });
});
