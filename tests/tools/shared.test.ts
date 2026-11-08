import { describe, it, expect } from "bun:test";
import {
  DEFAULT_TIMEFRAME,
  DEFAULT_TIMEZONE,
  buildReportQuery,
  filtersLine,
} from "../../src/tools/shared";

describe("buildReportQuery", () => {
  it("applies the default timezone and timeframe", () => {
    const { query, filters } = buildReportQuery({ tenantId: "tenant-1" });
    expect(query.tenantId).toBe("tenant-1");
    expect(query.timezone).toBe(DEFAULT_TIMEZONE);
    expect(query.timeframe).toBe(DEFAULT_TIMEFRAME);
    expect(query.startDate).toBeUndefined();
    expect(filters.sourceId).toBe("all");
    expect(filters.range).toBe(DEFAULT_TIMEFRAME);
  });

  it("switches to a custom range when startDate and endDate are given", () => {
    const { query, filters } = buildReportQuery({
      tenantId: "tenant-1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(query.timeframe).toBe("custom");
    expect(query.startDate).toBe("2026-01-01");
    expect(query.endDate).toBe("2026-01-31");
    expect(filters.range).toBe("2026-01-01 to 2026-01-31");
  });

  it("passes an explicit source and timezone through", () => {
    const { query, filters } = buildReportQuery({
      tenantId: "tenant-1",
      sourceId: "source-1",
      timezone: "UTC",
    });
    expect(query.sourceId).toBe("source-1");
    expect(query.timezone).toBe("UTC");
    expect(filters.sourceId).toBe("source-1");
  });

  it("omits trafficScope unless the option is provided", () => {
    const without = buildReportQuery({ tenantId: "tenant-1" });
    expect(without.query.trafficScope).toBeUndefined();
    expect(without.filters.consent).toBeUndefined();

    const withScope = buildReportQuery({ tenantId: "tenant-1" }, { trafficScope: "consented_traffic" });
    expect(withScope.query.trafficScope).toBe("consented_traffic");
    expect(withScope.filters.consent).toBe("consented_traffic");
  });
});

describe("filtersLine", () => {
  const base = { tenantId: "tenant-1", sourceId: "all", range: "last7days", timezone: DEFAULT_TIMEZONE };

  it("includes consent only when it is set", () => {
    expect(filtersLine(base)).not.toContain("consent:");
    expect(filtersLine({ ...base, consent: "all_traffic" })).toContain("consent: all_traffic");
  });

  it("always marks the data as aggregate only", () => {
    expect(filtersLine(base)).toContain("Aggregate data only");
  });
});
