import { describe, expect, it } from "bun:test";
import { config } from "../../src/config";
import { wellKnownRoutes } from "../../src/modules/well-known/routes";

const expectedMetadata = {
  resource: config.oauth.mcpResource,
  authorization_servers: [config.oauth.issuer],
  scopes_supported: ["reports:read"],
  bearer_methods_supported: ["header"],
};

function get(path: string) {
  return wellKnownRoutes.handle(new Request(`http://localhost${path}`));
}

describe("protected-resource metadata", () => {
  it("is served at the root well-known path used by the 401 challenge", async () => {
    const response = await get("/.well-known/oauth-protected-resource");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedMetadata);
  });

  it("is served at the well-known path of the legacy /mcp endpoint", async () => {
    const response = await get("/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedMetadata);
  });

  it("does not answer for a path that is not the resource", async () => {
    const response = await get("/.well-known/oauth-protected-resource/other");
    expect(response.status).toBe(404);
  });
});
