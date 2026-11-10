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

  it.each([[undefined], ["last30days"], ["custom"]])(
    "uses both dates as a custom range when timeframe is %p",
    (timeframe) => {
      const { query, filters } = buildReportQuery({
        tenantId: "tenant-1",
        timeframe,
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      });
      expect(query.timeframe).toBe("custom");
      expect(query.startDate).toBe("2026-01-01");
      expect(query.endDate).toBe("2026-01-31");
      expect(filters.range).toBe("2026-01-01 to 2026-01-31");
    },
  );

  it.each([
    { startDate: "2026-01-01" },
    { timeframe: "last30days", endDate: "2026-01-31" },
    { timeframe: "custom" },
    { timeframe: "custom", startDate: "2026-01-01" },
  ])("rejects incomplete date ranges (%j)", (input) => {
    expect(() => buildReportQuery({ tenantId: "tenant-1", ...input }))
      .toThrow("Provide both startDate and endDate");
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

  it("resolves an omitted timezone to the same query as explicit Europe/Istanbul across DST dates", () => {
    const periodsSpanningDstTransitions = [
      { startDate: "2026-03-27", endDate: "2026-03-30" },
      { startDate: "2026-10-23", endDate: "2026-10-26" },
    ];
    for (const period of periodsSpanningDstTransitions) {
      const omitted = buildReportQuery({ tenantId: "tenant-1", ...period });
      const explicit = buildReportQuery({
        tenantId: "tenant-1",
        ...period,
        timezone: DEFAULT_TIMEZONE,
      });
      expect(omitted).toEqual(explicit);
      expect(omitted.query.timezone).toBe("Europe/Istanbul");
      expect(omitted.query.startDate).toBe(period.startDate);
      expect(omitted.query.endDate).toBe(period.endDate);
      expect(filtersLine(omitted.filters)).toContain("timezone: Europe/Istanbul");
    }
  });

  it("keeps an explicit DST-observing timezone unchanged across a DST transition", () => {
    const { query, filters } = buildReportQuery({
      tenantId: "tenant-1",
      startDate: "2026-03-27",
      endDate: "2026-03-30",
      timezone: "Europe/Berlin",
    });
    expect(query.timezone).toBe("Europe/Berlin");
    expect(filters.timezone).toBe("Europe/Berlin");
    expect(filtersLine(filters)).toContain("timezone: Europe/Berlin");
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
