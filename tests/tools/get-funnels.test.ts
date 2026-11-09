import { afterEach, describe, expect, it, mock } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Call = { token: string; path: string; query?: Record<string, unknown> };
const calls: Call[] = [];

mock.module("../../src/reports/client", () => ({
  reportsApiRequest: async (token: string, path: string, query?: Record<string, unknown>) => {
    calls.push({ token, path, query });
    return { data: { ok: true }, meta: {} };
  },
}));

const { registerGetFunnelsTool } = await import("../../src/tools/get-funnels");

type Handler = (
  args: { funnelId?: string; tenantId: string; sourceId?: string },
  extra: { authInfo?: { token?: string } },
) => Promise<any>;

function funnelsHandler(): Handler {
  let captured: Handler | undefined;
  const server = {
    registerTool: (_name: string, _def: unknown, handler: Handler) => {
      captured = handler;
    },
  } as unknown as McpServer;
  registerGetFunnelsTool(server);
  if (!captured) throw new Error("get_funnels was not registered");
  return captured;
}

const extra = { authInfo: { token: "mcp-token" } };
const TENANT = "11111111-1111-1111-1111-111111111111";
const SOURCE = "22222222-2222-2222-2222-222222222222";
const FUNNEL = "33333333-3333-3333-3333-333333333333";

afterEach(() => {
  calls.length = 0;
});

describe("get_funnels source scope [P2]", () => {
  it("forwards sourceId when listing a tenant's funnels", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, sourceId: SOURCE }, extra);
    expect(calls[0].path).toBe("/funnels");
    expect(calls[0].query).toMatchObject({ tenantId: TENANT, sourceId: SOURCE });
    expect(result.isError).toBeUndefined();
  });

  it("rejects a sourceId on a funnel summary instead of mislabeling it", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, funnelId: FUNNEL, sourceId: SOURCE }, extra);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("saved");
    expect(calls.find((call) => call.path.includes("/summary"))).toBeUndefined();
  });

  it("summarizes without sending sourceId and labels the funnel's own saved source", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, funnelId: FUNNEL }, extra);
    const summary = calls.find((call) => call.path.includes("/summary"));
    expect(summary?.path).toBe(`/funnels/${FUNNEL}/summary`);
    expect(summary?.query?.sourceId).toBeUndefined();
    expect(result.structuredContent.appliedFilters.source).toBe("funnel-defined");
    expect(result.content[0].text).toContain("saved source");
  });
});
