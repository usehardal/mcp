import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "../../src/config";
import { resetDiscoveryCache } from "../../src/oauth/discovery";
import { reportsApiRequest } from "../../src/reports/client";
import { ToolFailure } from "../../src/tools/output/errors";

const authInfo: AuthInfo = { token: "mcp-token", clientId: "client-1", scopes: ["reports:read"], extra: { userId: "client-user" } };

function stubBeacon(report: () => Response, exchange: () => Response = () => Response.json({ access_token: "delegated", expires_in: 300 })) {
  const beacon = config.oauth.beaconApiUrl;
  return spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `${beacon}/.well-known/oauth-authorization-server`) {
      return Response.json({
        issuer: config.oauth.issuer, token_endpoint: `${beacon}/oauth/token`, introspection_endpoint: `${beacon}/oauth/introspect`,
        authorization_endpoint: `${beacon}/oauth/authorize`, registration_endpoint: `${beacon}/oauth/register`,
        revocation_endpoint: `${beacon}/oauth/revoke`, scopes_supported: ["reports:read"],
      });
    }
    if (url === `${beacon}/oauth/token`) return exchange();
    return report();
  }) as typeof fetch);
}

async function failure(promise: Promise<unknown>): Promise<ToolFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolFailure) return error;
    throw error;
  }
  throw new Error("expected a ToolFailure");
}

afterEach(() => {
  resetDiscoveryCache();
});

describe("reportsApiRequest failures", () => {
  it.each([
    [403, "tenant-not-granted", "access-denied", false],
    [404, "funnel-not-found", "resource-not-found", false],
    [400, "tenant-required", "invalid-arguments", false],
    [503, undefined, "upstream-unavailable", true],
  ])("maps a Beacon %s %s response to %s", async (status, code, expected, retryable) => {
    const fetchSpy = stubBeacon(() => Response.json({ success: false, error: code ? { code } : undefined }, { status }));
    try {
      const error = await failure(reportsApiRequest(authInfo, "/reports/overview", { tenantId: "t" }));
      expect(error.code).toBe(expected as ToolFailure["code"]);
      expect(error.retryAfterSeconds).toBeNull();
      expect(error.message).not.toContain("/reports/overview");
      if (code) expect(error.message).toContain(code);
      expect(["quota-exceeded", "upstream-unavailable"].includes(error.code)).toBe(retryable);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reads Retry-After on a Beacon 429 and treats a revoked exchange as access denied", async () => {
    const limited = stubBeacon(() => Response.json({ success: false, error: { code: "rate-limited" } }, { status: 429, headers: { "retry-after": "17" } }));
    try {
      const error = await failure(reportsApiRequest(authInfo, "/reports/overview", { tenantId: "t" }));
      expect(error).toMatchObject({ code: "quota-exceeded", retryAfterSeconds: 17 });
    } finally {
      limited.mockRestore();
    }
    const revoked = stubBeacon(
      () => Response.json({ success: true, data: {} }),
      () => Response.json({ error: "invalid_grant", error_description: "subject_token is not an active MCP access token" }, { status: 400 }),
    );
    try {
      const error = await failure(reportsApiRequest(authInfo, "/reports/overview", { tenantId: "t" }));
      expect(error.code).toBe("access-denied");
    } finally {
      revoked.mockRestore();
    }
  });

  it("maps Beacon's commerce currency rejection to currency-unavailable", async () => {
    const fetchSpy = stubBeacon(() => Response.json({ success: false, error: { code: "commerce-items-currency-unavailable" } }, { status: 400 }));
    try {
      const error = await failure(reportsApiRequest(authInfo, "/reports/commerce/items", { tenantId: "t" }));
      expect(error.code).toBe("currency-unavailable");
      expect(error.message).toContain("reporting currency");
      expect(error.message).not.toContain("/reports/commerce");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("treats a successful envelope without data as a contract mismatch and a missing user as denied", async () => {
    const odd = stubBeacon(() => Response.json({ success: true }));
    try {
      expect((await failure(reportsApiRequest(authInfo, "/reports/overview"))).code).toBe("upstream-contract-mismatch");
    } finally {
      odd.mockRestore();
    }
    expect((await failure(reportsApiRequest(undefined, "/reports/overview"))).code).toBe("access-denied");
  });
});
