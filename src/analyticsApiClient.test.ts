import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsApiClient, AnalyticsApiError } from './analyticsApiClient.js';
import type { HardalConfig } from './config.js';

function makeConfig(overrides: Partial<HardalConfig> = {}): HardalConfig {
  return {
    analytics: {
      baseUrl: 'https://api.nexus.usehardal.com',
      signalId: 'signal-123',
      signalToken: 'token-abc',
    },
    requestTimeoutMs: 1000,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function loginBody(overrides: Partial<{ token: string; expiresAt: number }> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    token: 'jwt-token-1',
    signalId: 'signal-123',
    ttl: 3600,
    issuedAt: now,
    expiresAt: now + 3600,
    expiresIn: 3600,
    ...overrides,
  };
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

/** A fake fetch that returns canned responses in call order; throws if it runs out. */
function fakeFetch(responses: Response[]): { impl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (i >= responses.length) {
      throw new Error(`fakeFetch: no more canned responses (call #${i + 1} to ${String(input)})`);
    }
    return responses[i++];
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('sends the raw JWT with no Bearer prefix as the Authorization header', async () => {
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody()),
    jsonResponse({ success: true, data: { ok: true } }),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/overview/', { query: { timeframe: 'custom' } });
  const headers = calls[1].init?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'jwt-token-1');
});

test('caches the token across multiple requests (logs in exactly once)', async () => {
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody()),
    jsonResponse({ success: true, data: { n: 1 } }),
    jsonResponse({ success: true, data: { n: 2 } }),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/overview/');
  await client.request('/analytics/overview/');
  assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 1);
});

test('logs in again once the cached token is at or past the refresh buffer', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody({ token: 'jwt-expiring', expiresAt: now + 30 })), // inside the 60s buffer
    jsonResponse({ success: true, data: {} }),
    jsonResponse(loginBody({ token: 'jwt-fresh', expiresAt: now + 3600 })),
    jsonResponse({ success: true, data: {} }),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/overview/');
  await client.request('/analytics/overview/');
  assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 2);
});

test('de-dupes concurrent logins when no token is cached yet', async () => {
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody()),
    jsonResponse({ success: true, data: { n: 1 } }),
    jsonResponse({ success: true, data: { n: 2 } }),
    jsonResponse({ success: true, data: { n: 3 } }),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await Promise.all([
    client.request('/analytics/overview/'),
    client.request('/analytics/events/'),
    client.request('/analytics/sessions/'),
  ]);
  assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 1);
});

test('retries once after a 401, succeeding if the retry works', async () => {
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody({ token: 'jwt-stale' })),
    jsonResponse({ success: false, error: { code: 'invalid-token-signature', message: 'bad token' } }, 401),
    jsonResponse(loginBody({ token: 'jwt-token-2' })),
    jsonResponse({ success: true, data: { ok: true } }),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  const result = await client.request('/analytics/overview/');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 2);
  const headers = calls[calls.length - 1].init?.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'jwt-token-2');
});

test('surfaces a clear error if the retry also gets a 401 (does not loop)', async () => {
  const { impl, calls } = fakeFetch([
    jsonResponse(loginBody({ token: 'jwt-stale' })),
    jsonResponse({ success: false, error: { code: 'invalid-token-signature', message: 'bad token' } }, 401),
    jsonResponse(loginBody({ token: 'jwt-still-bad' })),
    jsonResponse({ success: false, error: { code: 'invalid-token-signature', message: 'still bad' } }, 401),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await assert.rejects(client.request('/analytics/overview/'), (err: unknown) => {
    assert.ok(err instanceof AnalyticsApiError);
    assert.equal(err.code, 'invalid-token-signature');
    assert.equal(err.message, 'still bad');
    return true;
  });
  assert.equal(calls.filter((c) => c.url.includes('/auth/login')).length, 2, 'must not loop past one forced retry');
});

test('a failed login surfaces as AnalyticsApiError with code/message/details', async () => {
  const { impl } = fakeFetch([
    jsonResponse(
      { success: false, error: { code: 'invalid-credentials', message: 'invalid-credentials', details: { foo: 'bar' } } },
      401,
    ),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await assert.rejects(client.request('/analytics/overview/'), (err: unknown) => {
    assert.ok(err instanceof AnalyticsApiError);
    assert.equal(err.code, 'invalid-credentials');
    assert.equal(err.message, 'invalid-credentials');
    assert.deepEqual(err.details, { foo: 'bar' });
    return true;
  });
});

test('a failed (non-401) analytics call surfaces as AnalyticsApiError', async () => {
  const { impl } = fakeFetch([
    jsonResponse(loginBody()),
    jsonResponse(
      { success: false, error: { code: 'VALIDATION_ERROR', message: "Validation failed for 'category'" } },
      422,
    ),
  ]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await assert.rejects(
    client.request('/analytics/funnel/events', { method: 'POST', body: { funnelEvents: ['a'] } }),
    (err: unknown) => {
      assert.ok(err instanceof AnalyticsApiError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.httpStatus, 422);
      return true;
    },
  );
});

test('omits undefined query params and comma-joins array values', async () => {
  const { impl, calls } = fakeFetch([jsonResponse(loginBody()), jsonResponse({ success: true, data: {} })]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/events/', {
    query: {
      timeframe: 'custom',
      startDate: '2026-01-01',
      endDate: undefined,
      selectedEvents: ['page_view', 'identify'],
    },
  });
  const url = new URL(calls[calls.length - 1].url);
  assert.equal(url.searchParams.get('timeframe'), 'custom');
  assert.equal(url.searchParams.get('startDate'), '2026-01-01');
  assert.equal(url.searchParams.has('endDate'), false);
  assert.equal(url.searchParams.get('selectedEvents'), 'page_view,identify');
});

test('sends POST method, Content-Type, and a JSON body for funnel-style requests', async () => {
  const { impl, calls } = fakeFetch([jsonResponse(loginBody()), jsonResponse({ success: true, data: { rows: [] } })]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/funnel/events', {
    method: 'POST',
    query: { timeframe: 'custom' },
    body: { funnelEvents: ['page_view', 'form_success'] },
  });
  const call = calls[calls.length - 1];
  assert.equal(call.init?.method, 'POST');
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(call.init?.body, JSON.stringify({ funnelEvents: ['page_view', 'form_success'] }));
});

test('rejects with a timeout-shaped error when the request never resolves', async () => {
  const config = makeConfig({ requestTimeoutMs: 20 });
  const hangingFetch = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      // Mimics real fetch: the in-flight request rejects once aborted.
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted.')));
    });
  }) as unknown as typeof fetch;
  const client = createAnalyticsApiClient(config, hangingFetch);
  const start = Date.now();
  await assert.rejects(client.request('/analytics/overview/'), /timed out/i);
  assert.ok(Date.now() - start < 2000, 'timeout should fire well within the test window');
});

// --- Tenant isolation -------------------------------------------------------
// One client instance must never hand a token obtained with one credential pair
// to a request made with another. Under stdio this can't happen (one process, one
// customer), but these pin the behaviour so an HTTP/multi-tenant deployment can
// reuse the client without reintroducing a cross-tenant leak.

const TENANT_A = { signalId: 'signal-A', signalToken: 'token-A' };
const TENANT_B = { signalId: 'signal-B', signalToken: 'token-B' };

/**
 * A fake fetch that answers by credential rather than by call order: each
 * /auth/login returns a JWT derived from the posted signalId, and every
 * /analytics/* call echoes back the Authorization header it received.
 */
function credentialAwareFetch(): { impl: typeof fetch; logins: string[] } {
  const logins: string[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) {
      const { signalId } = JSON.parse(String(init?.body)) as { signalId: string };
      logins.push(signalId);
      const now = Math.floor(Date.now() / 1000);
      return jsonResponse({ token: `jwt-for-${signalId}`, expiresAt: now + 3600 });
    }
    const auth = (init?.headers as Record<string, string>)['Authorization'];
    return jsonResponse({ success: true, data: { sawToken: auth } });
  }) as unknown as typeof fetch;
  return { impl, logins };
}

test('two credential pairs never share a cached token', async () => {
  const { impl, logins } = credentialAwareFetch();
  const client = createAnalyticsApiClient(makeConfig(), impl);

  const a = await client.request<{ sawToken: string }>('/analytics/overview/', { credentials: TENANT_A });
  const b = await client.request<{ sawToken: string }>('/analytics/overview/', { credentials: TENANT_B });

  assert.equal(a.sawToken, 'jwt-for-signal-A');
  assert.equal(b.sawToken, 'jwt-for-signal-B');
  assert.deepEqual(logins, ['signal-A', 'signal-B'], 'each tenant logs in for itself');
});

test('a cached token is reused per tenant, not across tenants', async () => {
  const { impl, logins } = credentialAwareFetch();
  const client = createAnalyticsApiClient(makeConfig(), impl);

  await client.request('/analytics/overview/', { credentials: TENANT_A });
  await client.request('/analytics/overview/', { credentials: TENANT_A });
  await client.request('/analytics/overview/', { credentials: TENANT_B });
  await client.request('/analytics/overview/', { credentials: TENANT_B });

  assert.deepEqual(logins, ['signal-A', 'signal-B'], 'two logins total, one per tenant');
});

test('concurrent requests de-dupe login per tenant, not globally', async () => {
  const { impl, logins } = credentialAwareFetch();
  const client = createAnalyticsApiClient(makeConfig(), impl);

  await Promise.all([
    client.request('/analytics/overview/', { credentials: TENANT_A }),
    client.request('/analytics/overview/', { credentials: TENANT_A }),
    client.request('/analytics/overview/', { credentials: TENANT_B }),
    client.request('/analytics/overview/', { credentials: TENANT_B }),
  ]);

  assert.equal(logins.filter((s) => s === 'signal-A').length, 1);
  assert.equal(logins.filter((s) => s === 'signal-B').length, 1);
});

test("a 401 re-login for one tenant leaves another tenant's cached token intact", async () => {
  const logins: string[] = [];
  let failNextAForOnce = false;
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) {
      const { signalId } = JSON.parse(String(init?.body)) as { signalId: string };
      logins.push(signalId);
      const now = Math.floor(Date.now() / 1000);
      return jsonResponse({ token: `jwt-for-${signalId}-${logins.length}`, expiresAt: now + 3600 });
    }
    const auth = (init?.headers as Record<string, string>)['Authorization'];
    if (failNextAForOnce && auth.startsWith('jwt-for-signal-A')) {
      failNextAForOnce = false;
      return jsonResponse({ success: false, error: { code: 'unauthorized' } }, 401);
    }
    return jsonResponse({ success: true, data: { sawToken: auth } });
  }) as unknown as typeof fetch;

  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/overview/', { credentials: TENANT_A });
  const bBefore = await client.request<{ sawToken: string }>('/analytics/overview/', { credentials: TENANT_B });

  failNextAForOnce = true;
  const aRetried = await client.request<{ sawToken: string }>('/analytics/overview/', { credentials: TENANT_A });
  const bAfter = await client.request<{ sawToken: string }>('/analytics/overview/', { credentials: TENANT_B });

  assert.notEqual(aRetried.sawToken, 'jwt-for-signal-A-1', 'tenant A got a fresh token');
  assert.equal(bAfter.sawToken, bBefore.sawToken, "tenant B's token was untouched");
  assert.equal(logins.filter((s) => s === 'signal-B').length, 1, 'tenant B never re-logged-in');
});

test('falls back to the configured credentials when none are passed', async () => {
  const { impl, logins } = credentialAwareFetch();
  const client = createAnalyticsApiClient(makeConfig(), impl);
  const r = await client.request<{ sawToken: string }>('/analytics/overview/');
  assert.deepEqual(logins, ['signal-123']);
  assert.equal(r.sawToken, 'jwt-for-signal-123');
});

// --- Upstream protection ----------------------------------------------------
// A public HTTP deployment turns every unauthenticated request into a potential
// POST /auth/login. These pin the behaviour that stops that.

test('a rejected credential is not retried against the API on the next request', async () => {
  let logins = 0;
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith('/auth/login')) {
      logins++;
      return jsonResponse({ success: false, error: { code: 'signal-not-found' } }, 401);
    }
    return jsonResponse({ success: true, data: {} });
  }) as unknown as typeof fetch;

  const client = createAnalyticsApiClient(makeConfig(), impl);
  const creds = { signalId: 'bad', signalToken: 'bad' };
  for (let i = 0; i < 5; i++) {
    await assert.rejects(client.request('/analytics/overview/', { credentials: creds }), AnalyticsApiError);
  }
  assert.equal(logins, 1, 'five rejected requests, one upstream login');
});

test('an upstream outage is not cached as a credential failure', async () => {
  let logins = 0;
  let failing = true;
  const impl = (async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith('/auth/login')) {
      logins++;
      if (failing) return jsonResponse({ success: false, error: { code: 'boom' } }, 503);
      const now = Math.floor(Date.now() / 1000);
      return jsonResponse({ token: 'jwt-ok', expiresAt: now + 3600 });
    }
    return jsonResponse({ success: true, data: { ok: true } });
  }) as unknown as typeof fetch;

  const client = createAnalyticsApiClient(makeConfig(), impl);
  const creds = { signalId: 'good', signalToken: 'good' };
  await assert.rejects(client.request('/analytics/overview/', { credentials: creds }));

  // The moment the upstream recovers, the same credentials must work — a 5xx says
  // nothing about them, so it must not have been remembered as a rejection.
  failing = false;
  await client.request('/analytics/overview/', { credentials: creds });
  assert.equal(logins, 2);
});

test('one tenant being rejected does not affect another', async () => {
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).endsWith('/auth/login')) {
      const { signalId } = JSON.parse(String(init?.body)) as { signalId: string };
      if (signalId === 'bad') return jsonResponse({ success: false, error: { code: 'signal-not-found' } }, 401);
      const now = Math.floor(Date.now() / 1000);
      return jsonResponse({ token: `jwt-${signalId}`, expiresAt: now + 3600 });
    }
    return jsonResponse({ success: true, data: { ok: true } });
  }) as unknown as typeof fetch;

  const client = createAnalyticsApiClient(makeConfig(), impl);
  await assert.rejects(client.request('/x', { credentials: { signalId: 'bad', signalToken: 'b' } }));
  await client.request('/x', { credentials: { signalId: 'good', signalToken: 'g' } });
});

// --- Caller-supplied JWT ----------------------------------------------------
// The preferred credential for a hosted deployment: it expires on the API's
// schedule, and this server never handles the signal token that minted it.

test('a supplied JWT is used directly, with no login exchange', async () => {
  const { impl, calls } = fakeFetch([jsonResponse({ success: true, data: { ok: true } })]);
  const client = createAnalyticsApiClient(makeConfig(), impl);
  await client.request('/analytics/overview/', { credentials: { jwt: 'caller-jwt' } });

  assert.equal(calls.length, 1, 'no /auth/login round trip');
  assert.ok(!calls[0].url.endsWith('/auth/login'));
  assert.equal((calls[0].init?.headers as Record<string, string>)['Authorization'], 'caller-jwt');
});

test('an expired JWT is reported as such rather than silently retried', async () => {
  const { impl, calls } = fakeFetch([jsonResponse({ success: false, error: { code: 'unauthorized' } }, 401)]);
  const client = createAnalyticsApiClient(makeConfig(), impl);

  await assert.rejects(
    client.request('/analytics/overview/', { credentials: { jwt: 'stale-jwt' } }),
    (err: AnalyticsApiError) => {
      assert.equal(err.code, 'token-expired');
      assert.match(err.message, /auth\/login/);
      return true;
    },
  );
  // Retrying would mean logging in, and there is no signal token here to log in
  // with — so exactly one call must have been made.
  assert.equal(calls.length, 1);
});

test('a JWT caller and a signal-pair caller do not interfere', async () => {
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).endsWith('/auth/login')) {
      const now = Math.floor(Date.now() / 1000);
      return jsonResponse({ token: 'minted-jwt', expiresAt: now + 3600 });
    }
    return jsonResponse({ success: true, data: { saw: (init?.headers as Record<string, string>)['Authorization'] } });
  }) as unknown as typeof fetch;

  const client = createAnalyticsApiClient(makeConfig(), impl);
  const a = await client.request<{ saw: string }>('/x', { credentials: { jwt: 'caller-jwt' } });
  const b = await client.request<{ saw: string }>('/x', { credentials: { signalId: 's', signalToken: 't' } });

  assert.equal(a.saw, 'caller-jwt');
  assert.equal(b.saw, 'minted-jwt');
});
