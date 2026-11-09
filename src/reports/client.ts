import { config } from "../config";
import { exchangeForReportsApiToken } from "../oauth/token-exchange";

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

function buildUrl(path: string, query?: ReportsQuery) {
  const url = new URL(`${config.oauth.reportsApiResource}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function reportsApiRequest<T>(
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
