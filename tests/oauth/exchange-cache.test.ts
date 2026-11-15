import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { config } from "../../src/config";
import { resetDiscoveryCache } from "../../src/oauth/discovery";
import { exchangeReportsApiToken, resetExchangeCache } from "../../src/oauth/exchange-cache";

function stubExchange(exchange: () => Response) {
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
    throw new Error(`Unexpected upstream request to ${url}`);
  }) as typeof fetch);
}

afterEach(() => {
  resetDiscoveryCache();
  resetExchangeCache();
});

describe("exchangeReportsApiToken", () => {
  it("exchanges once per subject token, even for concurrent calls", async () => {
    let exchanges = 0;
    const fetchSpy = stubExchange(() => {
      exchanges += 1;
      return Response.json({ access_token: `delegated-${exchanges}`, expires_in: 300, scope: "reports:read" });
    });
    try {
      const [first, second] = await Promise.all([
        exchangeReportsApiToken("subject-a"),
        exchangeReportsApiToken("subject-a"),
      ]);
      expect(first.accessToken).toBe("delegated-1");
      expect(second.accessToken).toBe("delegated-1");
      expect((await exchangeReportsApiToken("subject-a")).accessToken).toBe("delegated-1");
      expect(exchanges).toBe(1);
      await exchangeReportsApiToken("subject-b");
      expect(exchanges).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("re-exchanges after the entry expires and does not cache failures", async () => {
    let now = Date.now();
    const nowSpy = spyOn(Date, "now").mockImplementation(() => now);
    let exchanges = 0;
    const fetchSpy = stubExchange(() => {
      exchanges += 1;
      return exchanges === 2
        ? Response.json({ error: "server_error" }, { status: 503 })
        : Response.json({ access_token: `delegated-${exchanges}`, expires_in: 300 });
    });
    try {
      expect((await exchangeReportsApiToken("subject-ttl")).accessToken).toBe("delegated-1");
      now += 4 * 60_000 + 1;
      await expect(exchangeReportsApiToken("subject-ttl")).rejects.toThrow("token exchange failed");
      expect((await exchangeReportsApiToken("subject-ttl")).accessToken).toBe("delegated-3");
      expect(exchanges).toBe(3);
    } finally {
      nowSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("does not cache a delegated token that is about to expire", async () => {
    let exchanges = 0;
    const fetchSpy = stubExchange(() => {
      exchanges += 1;
      return Response.json({ access_token: `delegated-${exchanges}`, expires_in: 20 });
    });
    try {
      await exchangeReportsApiToken("subject-short");
      await exchangeReportsApiToken("subject-short");
      expect(exchanges).toBe(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
