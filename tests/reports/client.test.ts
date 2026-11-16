import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "../../src/config";
import { resetDiscoveryCache } from "../../src/oauth/discovery";
import { resetExchangeCache } from "../../src/oauth/exchange-cache";
import { reportsApiRequest } from "../../src/reports/client";
import { runToolCall } from "../../src/reports/tool-call";
import { ToolFailure } from "../../src/tools/output/errors";

const authInfo: AuthInfo = { token: "mcp-token", clientId: "client-1", scopes: ["reports:read"], extra: { userId: "client-user" } };

function stubBeacon(
  report: (init?: RequestInit) => Response | Promise<Response>,
  exchange: () => Response = () => Response.json({ access_token: "delegated", expires_in: 300 }),
) {
  const beacon = config.oauth.beaconApiUrl;
  return spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === `${beacon}/.well-known/oauth-authorization-server`) {
      return Response.json({
        issuer: config.oauth.issuer, token_endpoint: `${beacon}/oauth/token`, introspection_endpoint: `${beacon}/oauth/introspect`,
        authorization_endpoint: `${beacon}/oauth/authorize`, registration_endpoint: `${beacon}/oauth/register`,
        revocation_endpoint: `${beacon}/oauth/revoke`, scopes_supported: ["reports:read"],
      });
    }
    if (url === `${beacon}/oauth/token`) return exchange();
    return report(init);
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
  resetExchangeCache();
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
      resetExchangeCache();
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

describe("reportsApiRequest bounds", () => {
  const configuredBodyLimit = config.reports.upstreamBodyLimitBytes;
  const configuredDeadline = config.reports.toolDeadlineMs;
  const configuredTenantLimit = config.reports.tenantRateLimitPerMinute;

  afterEach(() => {
    config.reports.upstreamBodyLimitBytes = configuredBodyLimit;
    config.reports.toolDeadlineMs = configuredDeadline;
    config.reports.tenantRateLimitPerMinute = configuredTenantLimit;
  });

  it("rejects an oversized report body from the declared length and while streaming", async () => {
    config.reports.upstreamBodyLimitBytes = 64;
    const huge = JSON.stringify({ success: true, data: { rows: "x".repeat(400) } });
    const declared = stubBeacon(() => new Response(huge, {
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(huge)) },
    }));
    try {
      expect((await failure(reportsApiRequest(authInfo, "/reports/overview"))).code).toBe("response-too-large");
    } finally {
      declared.mockRestore();
      resetExchangeCache();
    }

    const streamed = stubBeacon(() => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(huge));
        controller.close();
      },
    }), { headers: { "content-type": "application/json" } }));
    try {
      expect((await failure(reportsApiRequest(authInfo, "/reports/overview"))).code).toBe("response-too-large");
    } finally {
      streamed.mockRestore();
    }
  });

  it("maps a report fetch aborted by the tool budget to deadline-exceeded", async () => {
    config.reports.toolDeadlineMs = 1000;
    const fetchSpy = stubBeacon((init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ success: true, data: {} })), 5000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation timed out.", "TimeoutError"));
      });
    }));
    try {
      const error = await runToolCall({}, () => reportsApiRequest(authInfo, "/reports/overview").then(
        () => undefined,
        (reason: unknown) => reason,
      ));
      expect(error).toBeInstanceOf(ToolFailure);
      expect((error as ToolFailure).code).toBe("deadline-exceeded");
    } finally {
      fetchSpy.mockRestore();
    }
  }, 4000);

  it("counts tenant-scoped requests of every user against the tenant minute window", async () => {
    config.reports.tenantRateLimitPerMinute = 2;
    const fetchSpy = stubBeacon(() => Response.json({ success: true, data: {} }));
    const otherUser = { ...authInfo, extra: { userId: "second-user" } };
    try {
      await runToolCall({ tenantId: "window-tenant-1" }, () => reportsApiRequest(authInfo, "/reports/overview"));
      await runToolCall({ tenantId: "window-tenant-1" }, () => reportsApiRequest(otherUser, "/reports/overview"));
      const error = await failure(
        runToolCall({ tenantId: "window-tenant-1" }, () => reportsApiRequest(authInfo, "/reports/overview")),
      );
      expect(error).toMatchObject({ code: "quota-exceeded" });
      expect(error.message).toContain("workspace");
      await runToolCall({ tenantId: "window-tenant-2" }, () => reportsApiRequest(authInfo, "/reports/overview"));
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
