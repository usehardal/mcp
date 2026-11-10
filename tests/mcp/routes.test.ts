import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { resetDiscoveryCache } from "../../src/oauth/discovery";

let introspectionResult: unknown = { active: false };

mock.module("../../src/oauth/introspection", () => ({
  introspectToken: async () => introspectionResult,
}));

const { mcpRoutes } = await import("../../src/modules/mcp/routes");
const { config } = await import("../../src/config");

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function post(headers: Record<string, string> = {}, message: object = initialize) {
  return mcpRoutes.handle(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(message),
    }),
  );
}

function activeTokenFor(resource: string, userId = "user-1") {
  return {
    active: true,
    userId,
    clientId: "client-1",
    scopes: ["reports:read"],
    tenantIds: ["tenant-1"],
    resource,
    expiresAt: null,
  };
}

describe("POST /mcp authentication", () => {
  it("rejects a request with no bearer token", async () => {
    introspectionResult = { active: false };
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects an inactive token", async () => {
    introspectionResult = { active: false };
    const res = await post({ authorization: "Bearer dead" });
    expect(res.status).toBe(401);
  });

  it("rejects an active token issued for the Reports API resource [P2]", async () => {
    introspectionResult = activeTokenFor(config.oauth.reportsApiResource);
    const res = await post({ authorization: "Bearer reports-api-token" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error_description?: string };
    expect(body.error_description).toContain("MCP server");
  });

  it("accepts an active token issued for the MCP resource", async () => {
    introspectionResult = activeTokenFor(config.oauth.mcpResource);
    const res = await post({ authorization: "Bearer mcp-token" });
    expect(res.status).toBe(200);
  });
});

const tenantId = "11111111-1111-4111-8111-111111111111";
const compareArgs = {
  tenantId,
  currentStart: "2026-01-01",
  currentEnd: "2026-01-31",
  previousStart: "2025-12-01",
  previousEnd: "2025-12-31",
};

async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const response = await post({ authorization: `Bearer ${token}` }, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  expect(response.status).toBe(200);
  const { result } = await response.json() as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
  return result;
}

describe("POST /mcp report requests", () => {
  const configuredLimit = config.reports.rateLimitPerMinute;

  afterEach(() => {
    config.reports.rateLimitPerMinute = configuredLimit;
    resetDiscoveryCache();
    mock.restore();
  });

  it("shares a user's budget across tokens and reserves both comparison reads before exchange", async () => {
    config.reports.rateLimitPerMinute = 2;
    let now = Date.now();
    spyOn(Date, "now").mockImplementation(() => now);

    const beacon = config.oauth.beaconApiUrl;
    const exchangedTokens: string[] = [];
    const reportedStartDates: Array<string | null> = [];
    const beaconFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${beacon}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: config.oauth.issuer,
          token_endpoint: `${beacon}/oauth/token`,
          introspection_endpoint: `${beacon}/oauth/introspect`,
          authorization_endpoint: `${beacon}/oauth/authorize`,
          registration_endpoint: `${beacon}/oauth/register`,
          revocation_endpoint: `${beacon}/oauth/revoke`,
          scopes_supported: ["reports:read"],
        });
      }
      if (url === `${beacon}/oauth/token`) {
        const fields = new URLSearchParams(String(init?.body));
        exchangedTokens.push(fields.get("subject_token") ?? "");
        return Response.json({ access_token: "delegated-token", expires_in: 300, scope: "reports:read" });
      }
      if (url.startsWith(`${config.oauth.reportsApiResource}/reports/overview?`)) {
        reportedStartDates.push(new URL(url).searchParams.get("startDate"));
        return Response.json({ success: true, data: {} });
      }
      throw new Error(`Unexpected upstream request to ${url}`);
    }) as typeof fetch;
    spyOn(globalThis, "fetch").mockImplementation(beaconFetch);

    introspectionResult = activeTokenFor(config.oauth.mcpResource, "report-user-a");
    expect((await callTool("original", "get_overview", { tenantId })).isError).toBeUndefined();
    const blocked = await callTool("refreshed", "compare_periods", compareArgs);
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain("Retry in 60 seconds");
    expect(exchangedTokens).toEqual(["original"]);

    expect((await callTool("refreshed", "get_overview", { tenantId })).isError).toBeUndefined();
    expect((await callTool("refreshed", "get_context", {})).isError).toBe(true);
    expect(exchangedTokens).toEqual(["original", "refreshed"]);

    introspectionResult = activeTokenFor(config.oauth.mcpResource, "report-user-b");
    expect((await callTool("other-user", "compare_periods", compareArgs)).isError).toBeUndefined();
    expect((await callTool("other-user", "get_overview", { tenantId })).isError).toBe(true);
    expect(exchangedTokens).toEqual(["original", "refreshed", "other-user", "other-user"]);
    expect(reportedStartDates.slice(2).sort()).toEqual(["2025-12-01", "2026-01-01"]);

    now += 60_000;
    expect((await callTool("other-user", "get_overview", { tenantId })).isError).toBeUndefined();
    expect(exchangedTokens).toHaveLength(5);
  });

  it("rejects a single date before contacting the Reports API or exchanging a token", async () => {
    introspectionResult = activeTokenFor(config.oauth.mcpResource, "invalid-range-user");
    const upstream = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected upstream request"));
    const result = await callTool("mcp-token", "get_overview", { tenantId, startDate: "2026-01-01" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Provide both startDate and endDate");
    expect(upstream).not.toHaveBeenCalled();
  });
});
