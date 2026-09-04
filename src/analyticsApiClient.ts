import { createHash } from 'node:crypto';
import type { HardalConfig } from './config.js';
import { createFailureCache } from './rateLimit.js';

export type QueryValue = string | number | string[] | undefined;

/**
 * A signal id and token, which this client exchanges for a JWT via /auth/login.
 * The token is long-lived, so whoever holds it holds the signal indefinitely.
 */
export interface SignalCredentials {
  signalId: string;
  signalToken: string;
  jwt?: undefined;
}

/**
 * A JWT the caller obtained from /auth/login themselves.
 *
 * Strictly the better credential to hand a remote deployment: it expires on the
 * API's own schedule (an hour, at the time of writing), and this server never
 * sees the signal token that minted it — so there is no long-lived secret here to
 * cache, encrypt, or leak. The cost is that it stops working when it expires and
 * the caller has to supply a fresh one; nothing here can renew it.
 */
export interface JwtCredentials {
  jwt: string;
  signalId?: undefined;
  signalToken?: undefined;
}

/**
 * The Analytics API credentials a request authenticates with. Supplying these
 * per-request is what makes one client instance safe to share between callers —
 * see the tenant-isolation note on `createAnalyticsApiClient`.
 */
export type AnalyticsCredentials = SignalCredentials | JwtCredentials;

export interface AnalyticsApiRequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Defaults to the credentials in `config.analytics`. */
  credentials?: AnalyticsCredentials;
}

/**
 * The minimal structural interface tool files depend on — parallel to the old
 * clickhouseClient.ts's QueryRunner. Lets tests inject a fake instead of performing
 * a real login/HTTP call.
 */
export interface AnalyticsApiClient {
  request<T>(path: string, options?: AnalyticsApiRequestOptions): Promise<T>;
}

export class AnalyticsApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AnalyticsApiError';
  }
}

interface CachedToken {
  token: string;
  expiresAt: number; // unix seconds, from the API's own response — not derived locally
}

const TOKEN_REFRESH_BUFFER_SECONDS = 60;

/**
 * How long a rejected credential pair is remembered.
 *
 * Without this, every request bearing a bad credential becomes a fresh
 * POST /auth/login, which turns a public MCP endpoint into an unauthenticated
 * load generator against the Analytics API — and into a free oracle for guessing
 * signal tokens at upstream speed. Short enough that a customer who has just
 * rotated a token is not locked out for long.
 */
const AUTH_FAILURE_TTL_MS = 30_000;

/**
 * Derives the cache key for a credential pair.
 *
 * Hashed rather than used raw so that a signal token never ends up as a Map key,
 * where it could surface in a heap dump or a debugger. Both halves are length-
 * prefixed so that no two distinct pairs can produce the same input string.
 */
function tenantKey({ signalId, signalToken }: SignalCredentials): string {
  return createHash('sha256')
    .update(`${signalId.length}:${signalId}:${signalToken.length}:${signalToken}`)
    .digest('hex');
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  // Plain string concatenation rather than `new URL(path, base)`: an absolute-path
  // reference like '/analytics/overview/' would silently drop any sub-path in a
  // custom HARDAL_API_BASE_URL (e.g. a gateway at https://proxy.example.com/hardal).
  const url = new URL(baseUrl + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  return url.toString();
}

/**
 * Creates a client for Hardal's Analytics API.
 *
 * **Tenant isolation.** Cached JWTs are keyed by the credentials that obtained them,
 * never held as a single client-wide token. Under stdio — one process, one customer —
 * that distinction is invisible. It stops being invisible the moment this client is
 * reused inside a shared process (an HTTP/multi-tenant deployment), where a
 * client-wide cache would hand one customer's token to every other customer's
 * request. Keying the cache makes that class of leak structurally impossible rather
 * than merely unlikely, so callers may pass `credentials` per request.
 */
export function createAnalyticsApiClient(
  config: HardalConfig,
  fetchImpl: typeof fetch = fetch,
): AnalyticsApiClient {
  const tokensByTenant = new Map<string, CachedToken>();
  const pendingByTenant = new Map<string, Promise<CachedToken>>();
  const authFailures = createFailureCache(AUTH_FAILURE_TTL_MS);

  async function rawRequest(
    path: string,
    options: { method: 'GET' | 'POST'; query?: Record<string, QueryValue>; body?: unknown; token?: string },
  ): Promise<{ status: number; json: unknown }> {
    const url = buildUrl(config.analytics.baseUrl, path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (options.token !== undefined) headers.Authorization = options.token;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetchImpl(url, {
        method: options.method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new AnalyticsApiError(
          `Analytics API returned a non-JSON response from ${path} (HTTP ${response.status}).`,
          undefined,
          undefined,
          response.status,
        );
      }
      return { status: response.status, json };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new AnalyticsApiError(`Analytics API request to ${path} timed out after ${config.requestTimeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function login(credentials: AnalyticsCredentials): Promise<CachedToken> {
    const { status, json } = await rawRequest('/auth/login', {
      method: 'POST',
      body: { signalId: credentials.signalId, signalToken: credentials.signalToken },
    });
    // Unlike every /analytics/* response, a successful /auth/login response omits
    // `success` entirely (confirmed live) — only failures include `success: false`.
    const body = json as {
      success?: boolean;
      token?: string;
      expiresAt?: number;
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    if (body?.success === false || typeof body?.token !== 'string' || typeof body?.expiresAt !== 'number') {
      throw new AnalyticsApiError(
        body?.error?.message ?? `Analytics API login failed with HTTP ${status}.`,
        body?.error?.code,
        body?.error?.details,
        status,
      );
    }
    return { token: body.token, expiresAt: body.expiresAt };
  }

  async function getToken(credentials: AnalyticsCredentials, forceRefresh = false): Promise<string> {
    // A caller-supplied JWT is already the bearer the API wants: no exchange, and
    // nothing worth caching, since the value is the credential and its lifetime is
    // the API's to decide.
    if (credentials.jwt !== undefined) return credentials.jwt;

    const key = tenantKey(credentials as SignalCredentials);
    const nowSeconds = Date.now() / 1000;
    const cached = tokensByTenant.get(key);
    if (!forceRefresh && cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_SECONDS > nowSeconds) {
      return cached.token;
    }
    // De-dupe concurrent logins per tenant: if one is already in flight for these
    // credentials, every caller awaits the same promise instead of firing parallel
    // /auth/login calls. A login for one tenant never blocks or satisfies another.
    // A pair the API has already rejected is refused here, without a second call.
    const remembered = authFailures.get(key);
    if (remembered) throw remembered;

    let pending = pendingByTenant.get(key);
    if (!pending) {
      pending = login(credentials).finally(() => {
        pendingByTenant.delete(key);
      });
      pendingByTenant.set(key, pending);
    }
    let token: CachedToken;
    try {
      token = await pending;
    } catch (err) {
      // Only an outright rejection says anything about the credentials. A timeout
      // or a 5xx describes the upstream's health, and caching it would lock out a
      // valid customer for the whole window over a transient failure.
      if (err instanceof AnalyticsApiError && err.httpStatus !== undefined && err.httpStatus < 500) {
        authFailures.record(key, err);
      }
      throw err;
    }
    tokensByTenant.set(key, token);
    return token.token;
  }

  async function request<T>(path: string, options: AnalyticsApiRequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET';
    const credentials = options.credentials ?? {
      signalId: config.analytics.signalId,
      signalToken: config.analytics.signalToken,
    };
    let token = await getToken(credentials);
    let { status, json } = await rawRequest(path, { method, query: options.query, body: options.body, token });

    // A token can be invalidated server-side for reasons other than TTL expiry —
    // force exactly one re-login and retry, never loop. Only this tenant's entry is
    // refreshed; every other tenant's cached token is left alone.
    if (status === 401) {
      if (credentials.jwt !== undefined) {
        // Re-logging-in is what recovers a stale token, and that needs a signal
        // token this request never carried. Say so plainly: the caller has to
        // fetch a new JWT from /auth/login, and no retry here can help.
        throw new AnalyticsApiError(
          'The supplied Hardal token was rejected. It has most likely expired — ' +
            'obtain a new one from POST /auth/login and reconnect.',
          'token-expired',
          undefined,
          401,
        );
      }
      token = await getToken(credentials, true);
      ({ status, json } = await rawRequest(path, { method, query: options.query, body: options.body, token }));
    }

    const body = json as { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } } | null;
    if (body?.success !== true) {
      throw new AnalyticsApiError(
        body?.error?.message ?? `Analytics API request to ${path} failed with HTTP ${status}.`,
        body?.error?.code,
        body?.error?.details,
        status,
      );
    }
    return body.data as T;
  }

  return { request };
}
