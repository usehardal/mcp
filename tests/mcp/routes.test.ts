import { describe, expect, it, mock } from "bun:test";

let introspectionResult: unknown = { active: false };

mock.module("../../src/oauth/introspection", () => ({
  introspectToken: async () => introspectionResult,
}));

const { mcpRoutes } = await import("../../src/modules/mcp/routes");
const { config } = await import("../../src/config");

function post(headers: Record<string, string> = {}) {
  return mcpRoutes.handle(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      }),
    }),
  );
}

function activeTokenFor(resource: string) {
  return {
    active: true,
    userId: "user-1",
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
    expect(res.status).not.toBe(401);
  });
});
