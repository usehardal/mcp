import { config } from "../config";
import { ToolFailure } from "../tools/output/errors";

const ONE_MINUTE_MS = 60_000;

type RequestWindow = { expiresAt: number; count: number };

function createMinuteWindow(limitOf: () => number, limitMessage: string) {
  const windows = new Map<string, RequestWindow>();
  let nextSweepAt = 0;

  return function reserve(key: string, requestCount: number): void {
    const now = Date.now();
    if (now >= nextSweepAt) {
      for (const [windowKey, window] of windows) {
        if (now >= window.expiresAt) windows.delete(windowKey);
      }
      nextSweepAt = now + ONE_MINUTE_MS;
    }

    const activeWindow = windows.get(key);
    const window = activeWindow && now < activeWindow.expiresAt
      ? activeWindow
      : { expiresAt: now + ONE_MINUTE_MS, count: 0 };
    if (window.count + requestCount > limitOf()) {
      const retryAfterSeconds = Math.ceil((window.expiresAt - now) / 1000);
      throw new ToolFailure(
        "quota-exceeded",
        `${limitMessage}. Retry in ${retryAfterSeconds} seconds.`,
        { retryAfterSeconds },
      );
    }

    window.count += requestCount;
    windows.set(key, window);
  };
}

export const reserveReportRequests = createMinuteWindow(
  () => config.reports.rateLimitPerMinute,
  "Hardal report request limit reached",
);

export const reserveTenantReportRequests = createMinuteWindow(
  () => config.reports.tenantRateLimitPerMinute,
  "Hardal report request limit for this workspace reached",
);
