import { config } from "../config";
import { ToolFailure } from "../tools/output/errors";

const ONE_MINUTE_MS = 60_000;

type RequestWindow = { expiresAt: number; count: number };

const windows = new Map<string, RequestWindow>();
let nextSweepAt = 0;

export function reserveReportRequests(userId: string, requestCount: number): void {
  const now = Date.now();
  if (now >= nextSweepAt) {
    for (const [key, window] of windows) {
      if (now >= window.expiresAt) windows.delete(key);
    }
    nextSweepAt = now + ONE_MINUTE_MS;
  }

  const activeWindow = windows.get(userId);
  const window = activeWindow && now < activeWindow.expiresAt
    ? activeWindow
    : { expiresAt: now + ONE_MINUTE_MS, count: 0 };
  if (window.count + requestCount > config.reports.rateLimitPerMinute) {
    const retryAfterSeconds = Math.ceil((window.expiresAt - now) / 1000);
    throw new ToolFailure(
      "quota-exceeded",
      `Hardal report request limit reached. Retry in ${retryAfterSeconds} seconds.`,
      { retryAfterSeconds },
    );
  }

  window.count += requestCount;
  windows.set(userId, window);
}
