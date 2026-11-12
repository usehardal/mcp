import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { reportContext, type ReportScope } from "../../src/tools/output/context";
import { normalizePaths, nullPointers } from "../../src/tools/output/data";
import { ToolFailure, errorResult, toolFailure } from "../../src/tools/output/errors";
import { envelope, reportResult } from "../../src/tools/output/result";

const scope: ReportScope = {
  filters: { tenantId: "tenant-1", sourceId: "all", range: "2026-04-01 to 2026-04-07", timezone: "Europe/Istanbul" },
  range: { startDate: "2026-04-01", endDate: "2026-04-07" },
  timezoneOrigin: "default",
};
const measured = { missingValues: [], redactedLabels: 0 };

describe("normalizePaths", () => {
  it("cuts query strings and fragments from path and URL values only", () => {
    const { value, redacted } = normalizePaths({
      pagePath: "/a?b=1#c", from: "https://x.test/p?q=1", label: "why?", nested: [{ to: "/plain" }],
    });
    expect(value).toEqual({ pagePath: "/a", from: "https://x.test/p", label: "why?", nested: [{ to: "/plain" }] });
    expect(redacted).toBe(2);
  });
});

describe("nullPointers", () => {
  it("counts null leaves per column, leaves zeros alone and skips server-owned pagination", () => {
    expect(nullPointers({ a: 0, b: null, rows: [{ "x/y": null }, { "x/y": null }], pagination: { total: null, hasMore: null } })).toEqual([
      { path: "/data/b", reason: "upstream_null", count: 1 },
      { path: "/data/rows/*/x~1y", reason: "upstream_null", count: 2 },
    ]);
  });

  it("labels a zero previous value as a zero denominator and keeps long series small", () => {
    expect(nullPointers({ metrics: { sessions: { previous: 0, relativeChangePercent: null, reason: "previous-zero" } } })).toEqual([
      { path: "/data/metrics/sessions/relativeChangePercent", reason: "zero_denominator", count: 1 },
    ]);
    const trend = Array.from({ length: 1500 }, (_, index) => ({ date: String(index), revenue: null }));
    expect(nullPointers({ trend })).toEqual([{ path: "/data/trend/*/revenue", reason: "upstream_null", count: 1500 }]);
  });
});

describe("toolFailure", () => {
  it("maps coded messages, zod errors and unknown errors", () => {
    expect(toolFailure(new Error("range-too-large: Too many days."))).toMatchObject({ code: "range-too-large", message: "Too many days." });
    const zodError = z.object({ sortBy: z.enum(["a"]) }).safeParse({ sortBy: "b" }).error!;
    expect(toolFailure(zodError)).toMatchObject({ code: "invalid-arguments", fields: ["sortBy"] });
    expect(toolFailure(new TypeError("boom"))).toMatchObject({ code: "upstream-contract-mismatch" });
    expect(toolFailure(new Error("Reports API request to /reports/x failed: HTTP 500")).message).not.toContain("/reports/x");
  });

  it("marks quota and upstream failures retryable and keeps the envelope out of structuredContent", () => {
    const result = errorResult(new ToolFailure("quota-exceeded", "Slow down.", { retryAfterSeconds: 42 }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toEqual({ type: "text", text: "quota-exceeded: Slow down." });
    expect(JSON.parse((result.content[1] as { text: string }).text)).toEqual({
      schemaVersion: "1.0.0", ok: false,
      error: { code: "quota-exceeded", message: "Slow down.", retryable: true, retryAfterSeconds: 42 },
    });
  });
});

describe("reportContext", () => {
  it("derives completeness from pagination and reports unknown totals as incomplete", () => {
    const paged = reportContext(scope, {
      pagination: { limit: 20, offset: 0, returnedRows: 20, total: null, hasMore: null, truncated: true },
    }, measured);
    expect(paged.completeness).toEqual({ complete: false, reason: "upstream_limit", returnedRows: 20, limit: 20, hasMore: null });
    const full = reportContext(scope, { returnedRows: 3 }, measured);
    expect(full.completeness).toEqual({ complete: true, reason: null, returnedRows: 3, limit: null, hasMore: null });
  });

  it("echoes applied filters, previous range and currency, defaulting the rest", () => {
    const context = reportContext(scope, {
      applied: { channel: "Direct", path: undefined, filter: { field: "campaign", value: "spring" } },
      previousRange: { startDate: "2026-03-25", endDate: "2026-03-31" },
      currency: { reportingCurrency: "TRY" },
      interval: "day",
    }, { missingValues: [{ path: "/data/x", reason: "upstream_null", count: 1 }], redactedLabels: 2 });
    expect(context.filters).toEqual([
      { name: "channel", status: "applied", value: "Direct" },
      { name: "filter", status: "applied", value: { field: "campaign", value: "spring" } },
    ]);
    expect(context.previousRange).toEqual({ startDate: "2026-03-25", endDate: "2026-03-31", timezone: "Europe/Istanbul" });
    expect(context.currency).toEqual({ reportingCurrency: "TRY", status: "available", excludedCount: null });
    expect(context).toMatchObject({
      tenantId: "tenant-1", source: { mode: "all_sources", sourceId: null }, timeBasis: "calendar_range", window: null,
      range: { startDate: "2026-04-01", endDate: "2026-04-07", timezone: "Europe/Istanbul" }, interval: "day",
      missingValues: [{ path: "/data/x", reason: "upstream_null", count: 1 }], redactedLabels: 2,
    });
    const bare = reportContext({ ...scope, range: null }, {}, measured);
    expect(bare.currency).toEqual({ reportingCurrency: null, status: "not_applicable", excludedCount: null });
    expect(bare.timeBasis).toBe("catalog");
  });
});

describe("envelope", () => {
  it("rejects output above 256 KiB with a response-too-large failure", () => {
    expect(() => envelope("text", {}, { rows: "x".repeat(256 * 1024) })).toThrow(ToolFailure);
    const result = envelope("text", { generatedAt: "now" }, { report: { sessions: 1 } });
    expect(result.structuredContent).toEqual({ schemaVersion: "1.0.0", ok: true, context: { generatedAt: "now" }, data: { report: { sessions: 1 } } });
    expect(result.content).toHaveLength(2);
    expect(JSON.parse((result.content[1] as { text: string }).text)).toEqual(result.structuredContent);
  });

  it("keeps today's report, appliedFilters and extra fields under data", () => {
    const result = reportResult({ scoreCards: { sessions: 0 }, pagePath: "/p?x=1" }, {
      scope, filters: scope.filters, fields: { reportType: "pages" },
    });
    expect(result.structuredContent?.data).toEqual({
      reportType: "pages", appliedFilters: scope.filters, report: { scoreCards: { sessions: 0 }, pagePath: "/p" },
    });
    expect((result.structuredContent?.context as { redactedLabels: number }).redactedLabels).toBe(1);
  });
});
