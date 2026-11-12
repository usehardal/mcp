import { describe, expect, it } from "bun:test";
import { createWellKnownRoutes } from "../../src/modules/well-known/routes";

const metadataPath = "/.well-known/oauth-protected-resource";
const issuer = "https://api.test";

function metadataFor(resource: string) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ["reports:read"],
    bearer_methods_supported: ["header"],
  };
}

function get(resource: string, path: string) {
  return createWellKnownRoutes({ resource, issuer, metadataPath }).handle(
    new Request(`http://localhost${path}`),
  );
}

describe("protected-resource metadata", () => {
  it("is served at the root well-known path used by the 401 challenge", async () => {
    const response = await get("https://mcp.test", metadataPath);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadataFor("https://mcp.test"));
  });

  it("serves no path-aware well-known URL for a root resource", async () => {
    const response = await get("https://mcp.test", `${metadataPath}/mcp`);
    expect(response.status).toBe(404);
  });

  it("is also served at the path-aware well-known URL of a resource that has a path", async () => {
    const response = await get("https://mcp.test/mcp", `${metadataPath}/mcp`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(metadataFor("https://mcp.test/mcp"));
  });

  it("does not answer for a path that is not the resource", async () => {
    const response = await get("https://mcp.test/mcp", `${metadataPath}/other`);
    expect(response.status).toBe(404);
  });
});
