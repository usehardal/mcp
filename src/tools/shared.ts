import { z } from "zod";
import type { ReportsQuery } from "../reports/client";

export const DEFAULT_TIMEZONE = "Europe/Istanbul";
export const DEFAULT_TIMEFRAME = "last7days";

export const calendarDate = z.iso.date().describe("YYYY-MM-DD");

export const tenantIdInput = z
  .string()
  .uuid()
  .describe("Tenant to query. Get it from get_context first.");

export const timeRangeInput = {
  timeframe: z
    .enum(["today", "yesterday", "last7days", "last30days", "custom"])
    .optional()
    .describe("Preset range. Defaults to last7days. Use custom with startDate and endDate."),
  startDate: calendarDate.optional().describe("Start date, required when timeframe is custom."),
  endDate: calendarDate.optional().describe("End date, required when timeframe is custom."),
  timezone: z.string().optional().describe(`IANA timezone. Defaults to ${DEFAULT_TIMEZONE}.`),
};

export const reportScopeInput = {
  tenantId: tenantIdInput,
  sourceId: z.string().uuid().optional().describe("Limit to one source. Omit for all sources."),
};

export const trafficScopeInput = z
  .enum(["consented_traffic", "unconsented_traffic", "all_traffic"])
  .optional()
  .describe("Consent filter for Acquisition. Omit to use the tenant setting in Beacon.");

export type ReportInput = {
  tenantId: string;
  sourceId?: string;
  timeframe?: string;
  startDate?: string;
  endDate?: string;
  timezone?: string;
};

export type ResolvedFilters = {
  tenantId: string;
  sourceId: string;
  range: string;
  timezone: string;
  consent?: string;
};

export function buildReportQuery(
  input: ReportInput,
  options?: { trafficScope?: string },
): { query: ReportsQuery; filters: ResolvedFilters } {
  const { startDate, endDate } = input;
  const isCustom = input.timeframe === "custom" || startDate !== undefined || endDate !== undefined;
  if (isCustom && (!startDate || !endDate)) {
    throw new Error("invalid-date-range: Provide both startDate and endDate for a custom date range.");
  }
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;

  const query: ReportsQuery = { tenantId: input.tenantId, timezone };
  if (input.sourceId) query.sourceId = input.sourceId;
  if (options?.trafficScope) query.trafficScope = options.trafficScope;
  if (isCustom) {
    query.timeframe = "custom";
    query.startDate = startDate;
    query.endDate = endDate;
  } else {
    query.timeframe = input.timeframe ?? DEFAULT_TIMEFRAME;
  }

  const filters: ResolvedFilters = {
    tenantId: input.tenantId,
    sourceId: input.sourceId ?? "all",
    range: isCustom ? `${startDate} to ${endDate}` : String(query.timeframe),
    timezone,
    ...(options?.trafficScope ? { consent: options.trafficScope } : {}),
  };
  return { query, filters };
}

export function filtersLine(filters: ResolvedFilters): string {
  const consent = filters.consent ? `, consent: ${filters.consent}` : "";
  return `Filters — range: ${filters.range}, timezone: ${filters.timezone}, source: ${filters.sourceId}${consent}. Aggregate data only.`;
}
