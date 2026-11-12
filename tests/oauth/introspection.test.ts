import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { introspectToken } from "../../src/oauth/introspection";
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
let introspectBody: unknown;
let introspectStatus = 200;
let lastBody = "";

beforeEach(() => {
  resetDiscoveryCache();
  introspectBody = { active: false };
  introspectStatus = 200;
  lastBody = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/.well-known/oauth-authorization-server")) {
      return new Response(JSON.stringify(DISCOVERY), { status: 200 });
    }
    if (url === DISCOVERY.introspection_endpoint) {
      lastBody = String(init?.body ?? "");
      return new Response(JSON.stringify(introspectBody), { status: introspectStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("introspectToken", () => {
  it("maps an active token to a structured result and signs the request", async () => {
    introspectBody = {
      active: true,
      sub: "user-1",
      client_id: "client-1",
      scope: "reports:read",
      aud: "http://localhost:1922",
      exp: 1900000000,
      tenant_ids: ["tenant-1"],
    };
    const result = await introspectToken("token-A");
    expect(result.active).toBe(true);
    if (result.active) {
      expect(result.userId).toBe("user-1");
      expect(result.clientId).toBe("client-1");
      expect(result.scopes).toEqual(["reports:read"]);
      expect(result.tenantIds).toEqual(["tenant-1"]);
      expect(result.resource).toBe("http://localhost:1922");
      expect(result.expiresAt).toBe(1900000000);
    }
    expect(lastBody).toContain("token=token-A");
    expect(lastBody).toContain("client_assertion=");
  });

  it("treats an inactive token as not active", async () => {
    introspectBody = { active: false };
    expect((await introspectToken("token-A")).active).toBe(false);
  });

  it("treats an active token with no subject as not active", async () => {
    introspectBody = { active: true };
    expect((await introspectToken("token-A")).active).toBe(false);
  });

  it("throws when introspection responds with a non-2xx status", async () => {
    introspectStatus = 401;
    introspectBody = { error: "invalid_client" };
    await expect(introspectToken("token-A")).rejects.toThrow(/introspection failed/);
  });
});
