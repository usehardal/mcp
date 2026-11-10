import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { config } from "../config";
import { exchangeForReportsApiToken } from "../oauth/token-exchange";
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
    throw new Error("Missing authenticated Hardal user.");
  }

  reserveReportRequests(userId, requestCount);
  return authInfo.token;
}

async function fetchReport<T>(
  subjectToken: string,
  request: ReportRequest,
): Promise<ReportsApiResult<T>> {
  const delegated = await exchangeForReportsApiToken(subjectToken);
  const headers = new Headers({ Authorization: `Bearer ${delegated.accessToken}` });
  const init: RequestInit = { headers };
  if (request.method === "POST") {
    headers.set("Content-Type", "application/json");
    init.method = request.method;
    init.body = JSON.stringify(request.body);
  }
  const response = await fetch(buildUrl(request.path, request.query), init);

  const body = (await response.json().catch(() => null)) as ReportsApiEnvelope<T> | null;
  if (!response.ok || body?.success !== true || body.data === undefined) {
    const code = body?.error?.code;
    const reason = typeof code === "string" && /^[a-z0-9-]{1,64}$/.test(code)
      ? code
      : response.ok ? "upstream-contract-mismatch" : `HTTP ${response.status}`;
    throw new Error(`Reports API request to ${request.path} failed: ${reason}`);
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
