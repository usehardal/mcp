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
  error?: { code?: string; message?: string };
};

export type ReportsQuery = Record<string, string | number | boolean | undefined>;

type ReportRequest = { path: string; query?: ReportsQuery };

function buildUrl(path: string, query?: ReportsQuery) {
  const url = new URL(`${config.oauth.reportsApiResource}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
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
  path: string,
  query?: ReportsQuery,
): Promise<ReportsApiResult<T>> {
  const delegated = await exchangeForReportsApiToken(subjectToken);
  const response = await fetch(buildUrl(path, query), {
    headers: { Authorization: `Bearer ${delegated.accessToken}` },
  });

  const body = (await response.json()) as ReportsApiEnvelope<T>;
  if (!response.ok || body.success !== true || body.data === undefined) {
    const reason = body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`;
    throw new Error(`Reports API request to ${path} failed: ${reason}`);
  }

  return { data: body.data, meta: body.meta };
}

export async function reportsApiRequest<T>(
  authInfo: AuthInfo | undefined,
  path: string,
  query?: ReportsQuery,
): Promise<ReportsApiResult<T>> {
  const subjectToken = authorizeReportRequests(authInfo, 1);
  return fetchReport<T>(subjectToken, path, query);
}

export async function reportsApiRequests<T>(
  authInfo: AuthInfo | undefined,
  requests: readonly ReportRequest[],
): Promise<ReportsApiResult<T>[]> {
  const subjectToken = authorizeReportRequests(authInfo, requests.length);
  return Promise.all(requests.map(({ path, query }) => fetchReport<T>(subjectToken, path, query)));
}
