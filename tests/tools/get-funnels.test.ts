import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as reportsClient from "../../src/reports/client";
import { registerGetFunnelsTool } from "../../src/tools/get-funnels";

let requests: Mock<typeof reportsClient.reportsApiRequest>;

type Handler = (
  args: { funnelId?: string; tenantId: string; sourceId?: string },
  extra: { authInfo?: AuthInfo },
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

const extra = {
  authInfo: { token: "mcp-token", clientId: "mcp-client", scopes: ["reports:read"], extra: { userId: "user-1" } },
};
const TENANT = "11111111-1111-1111-1111-111111111111";
const SOURCE = "22222222-2222-2222-2222-222222222222";
const FUNNEL = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  requests = spyOn(reportsClient, "reportsApiRequest").mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  requests.mockRestore();
});

describe("get_funnels source scope [P2]", () => {
  it("forwards sourceId when listing a tenant's funnels", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, sourceId: SOURCE }, extra);
    expect(requests).toHaveBeenCalledWith(extra.authInfo, "/funnels", { tenantId: TENANT, sourceId: SOURCE });
    expect(result.isError).toBeUndefined();
  });

  it("rejects a sourceId on a funnel summary instead of mislabeling it", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, funnelId: FUNNEL, sourceId: SOURCE }, extra);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("saved");
    expect(requests).not.toHaveBeenCalled();
  });

  it("summarizes without sending sourceId and labels the funnel's own saved source", async () => {
    const result = await funnelsHandler()({ tenantId: TENANT, funnelId: FUNNEL }, extra);
    const [, path, query] = requests.mock.calls[0];
    expect(path).toBe(`/funnels/${FUNNEL}/summary`);
    expect(query?.sourceId).toBeUndefined();
    expect(result.structuredContent.appliedFilters.source).toBe("funnel-defined");
    expect(result.content[0].text).toContain("saved source");
  });
});
