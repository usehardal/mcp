import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { exchangeForReportsApiToken } from "../../src/oauth/token-exchange";
import { resetDiscoveryCache } from "../../src/oauth/discovery";

const DISCOVERY = {
  issuer: "http://localhost:1919",
  token_endpoint: "http://localhost:1919/oauth/token",
  introspection_endpoint: "http://localhost:1919/oauth/introspect",
  authorization_endpoint: "http://localhost:1919/oauth/authorize",
  registration_endpoint: "http://localhost:1919/oauth/register",
  revocation_endpoint: "http://localhost:1919/oauth/revoke",
  scopes_supported: ["reports:read"],
};

const realFetch = globalThis.fetch;
let tokenBody: unknown;
let tokenStatus = 200;
let lastBody = "";

beforeEach(() => {
  resetDiscoveryCache();
  tokenBody = {};
  tokenStatus = 200;
  lastBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return new Response(JSON.stringify(DISCOVERY), { status: 200 });
    }
    if (url === DISCOVERY.token_endpoint) {
      lastBody = String(init?.body ?? "");
      return new Response(JSON.stringify(tokenBody), { status: tokenStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("exchangeForReportsApiToken", () => {
  it("requests a Reports API-scoped token through token exchange", async () => {
    tokenBody = { access_token: "token-B", token_type: "Bearer", expires_in: 300, scope: "reports:read" };
    const result = await exchangeForReportsApiToken("token-A");
    expect(result.accessToken).toBe("token-B");
    expect(result.expiresInSeconds).toBe(300);
    expect(result.scopes).toEqual(["reports:read"]);

    const params = new URLSearchParams(lastBody);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(params.get("subject_token")).toBe("token-A");
    expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:access_token");
    expect(params.get("resource")).toBe("http://localhost:1919/v1");
    expect(params.get("scope")).toBe("reports:read");
    expect(params.get("client_assertion")).toBeTruthy();
    expect(params.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
  });

  it("throws with the server reason when the exchange is rejected", async () => {
    tokenStatus = 400;
    tokenBody = { error: "invalid_grant", error_description: "bad token" };
    await expect(exchangeForReportsApiToken("token-A")).rejects.toThrow(/token exchange failed: bad token/);
  });
});
