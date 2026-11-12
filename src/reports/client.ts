import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "../config";
import { exchangeForReportsApiToken } from "../oauth/token-exchange";
import { ToolFailure } from "../tools/output/errors";
import { reserveReportRequests } from "./rate-limit";

export type ReportsApiResult<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

type ReportsApiEnvelope<T> = {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code?: string };
};

export type ReportsQuery = Record<string, string | number | boolean | readonly string[] | undefined>;

type ReadOnlyPost = {
  method: "POST";
  path: "/reports/pages/time-series" | "/reports/commerce/items/details" | "/funnels/preview";
  body: object;
};

export type ReportRequest =
  | { path: string; query?: ReportsQuery; method?: "GET" }
  | (ReadOnlyPost & { query?: ReportsQuery });

const deniedExchange = /invalid_grant|invalid_token|unauthorized_client|invalid_scope|invalid_target|access_denied/;

function buildUrl(path: string, query?: ReportsQuery) {
  const url = new URL(`${config.oauth.reportsApiResource}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "object") {
        for (const entry of value) url.searchParams.append(key, entry);
      } else if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

function authorizeReportRequests(authInfo: AuthInfo | undefined, requestCount: number): string {
  const userId = authInfo?.extra?.userId;
  if (!authInfo?.token || typeof userId !== "string" || !userId) {
    throw new ToolFailure("access-denied", "Missing authenticated Hardal user.");
  }

  reserveReportRequests(userId, requestCount);
  return authInfo.token;
}

function exchangeFailure(error: unknown): ToolFailure {
  const message = error instanceof Error ? error.message : "";
  return deniedExchange.test(message)
    ? new ToolFailure("access-denied", "The Hardal sign-in no longer authorizes report requests. Sign in again.")
    : new ToolFailure("upstream-unavailable", "Hardal could not authorize the report request. Try again shortly.");
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function upstreamFailure(response: Response, code: unknown): ToolFailure {
  const reason = typeof code === "string" && /^[a-z0-9-]{1,64}$/.test(code) ? ` (${code})` : "";
  if (response.ok) return new ToolFailure("upstream-contract-mismatch", `Beacon returned an unexpected report envelope${reason}.`);
  if (response.status === 401 || response.status === 403) {
    return new ToolFailure("access-denied", `Beacon declined the report request${reason}.`);
  }
  if (response.status === 404) return new ToolFailure("resource-not-found", `Beacon has no such report or funnel${reason}.`);
  if (response.status === 429) {
    return new ToolFailure("quota-exceeded", `Beacon rate limited the report request${reason}.`, {
      retryAfterSeconds: retryAfterSeconds(response),
    });
  }
  if (response.status >= 500) return new ToolFailure("upstream-unavailable", `Beacon answered HTTP ${response.status}${reason}.`);
  return new ToolFailure("invalid-arguments", `Beacon rejected the report request${reason}.`);
}

async function fetchReport<T>(
  subjectToken: string,
  request: ReportRequest,
): Promise<ReportsApiResult<T>> {
  const delegated = await exchangeForReportsApiToken(subjectToken).catch((error: unknown) => {
    throw exchangeFailure(error);
  });
  const headers = new Headers({ Authorization: `Bearer ${delegated.accessToken}` });
  const init: RequestInit = { headers };
  if (request.method === "POST") {
    headers.set("Content-Type", "application/json");
    init.method = request.method;
    init.body = JSON.stringify(request.body);
  }
  const response = await fetch(buildUrl(request.path, request.query), init).catch(() => {
    throw new ToolFailure("upstream-unavailable", "Beacon is unreachable. Try again shortly.");
  });

  const body = (await response.json().catch(() => null)) as ReportsApiEnvelope<T> | null;
  if (!response.ok || body?.success !== true || body.data === undefined) {
    throw upstreamFailure(response, body?.error?.code);
  }

  return { data: body.data, meta: body.meta };
}

export async function reportsApiRequest<T>(
  authInfo: AuthInfo | undefined,
  path: string | ReportRequest,
  query?: ReportsQuery,
): Promise<ReportsApiResult<T>> {
  const subjectToken = authorizeReportRequests(authInfo, 1);
  return fetchReport<T>(subjectToken, typeof path === "string" ? { path, query } : path);
}

export async function reportsApiRequests<T>(
  authInfo: AuthInfo | undefined,
  requests: readonly ReportRequest[],
): Promise<ReportsApiResult<T>[]> {
  const subjectToken = authorizeReportRequests(authInfo, requests.length);
  return Promise.all(requests.map((request) => fetchReport<T>(subjectToken, request)));
}
