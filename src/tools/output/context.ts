import { z } from "zod";
import type { CalendarRange } from "../report-arguments";
import { DEFAULT_TIMEZONE, type ResolvedFilters } from "../shared";
import type { MissingValue } from "./data";

export type TimezoneOrigin = "explicit" | "default";
export type SourceMode = "all_sources" | "source" | "saved_funnel";
export type TimeBasis = "calendar_range" | "rolling_window" | "catalog";

export type ReportScope = {
  filters: ResolvedFilters;
  range: CalendarRange | null;
  timezoneOrigin: TimezoneOrigin;
  timeBasis?: TimeBasis;
  sourceMode?: SourceMode;
};

export type Pagination = {
  limit: number;
  offset: number;
  returnedRows: number;
  total: number | null;
  hasMore: boolean | null;
  truncated: boolean;
};

export type ContextOptions = {
  previousRange?: unknown;
  interval?: string | null;
  window?: { minutes: number; asOf: string } | null;
  applied?: Record<string, unknown>;
  currency?: unknown;
  pagination?: Pagination | null;
  returnedRows?: number;
};

type Measured = { missingValues: MissingValue[]; redactedLabels: number };

const upstreamRange = z.object({ startDate: z.string(), endDate: z.string(), timezone: z.string().optional() });
const upstreamCurrency = z.object({
  reportingCurrency: z.string().nullable().optional(),
  status: z.string().optional(),
  excludedCount: z.number().nullable().optional(),
});

export function timezoneOrigin(input: { timezone?: string }): TimezoneOrigin {
  return input.timezone === undefined ? "default" : "explicit";
}

export function catalogScope(input: { tenantId: string; sourceId?: string; timezone?: string }): ReportScope {
  return {
    filters: {
      tenantId: input.tenantId,
      sourceId: input.sourceId ?? "all",
      range: "catalog",
      timezone: input.timezone ?? DEFAULT_TIMEZONE,
    },
    range: null,
    timezoneOrigin: timezoneOrigin(input),
    timeBasis: "catalog",
  };
}

export function realtimeScope(input: { tenantId: string; sourceId?: string }): ReportScope {
  const scope = catalogScope(input);
  return { ...scope, filters: { ...scope.filters, range: "rolling" }, timeBasis: "rolling_window" };
}

export function catalogContext() {
  return { generatedAt: new Date().toISOString(), timeBasis: "catalog" as const };
}

function previousRange(value: unknown, timezone: string) {
  const parsed = upstreamRange.safeParse(value);
  if (!parsed.success) return null;
  return { startDate: parsed.data.startDate, endDate: parsed.data.endDate, timezone: parsed.data.timezone ?? timezone };
}

function appliedFilters(applied: Record<string, unknown> = {}) {
  return Object.entries(applied)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({ name, status: "applied" as const, value }));
}

function currency(value: unknown) {
  const parsed = value === undefined || value === null ? undefined : upstreamCurrency.safeParse(value);
  if (!parsed?.success) return { reportingCurrency: null, status: "not_applicable", excludedCount: null };
  const { reportingCurrency = null, status = "available", excludedCount = null } = parsed.data;
  return { reportingCurrency, status, excludedCount };
}

function completeness(pagination: Pagination | null | undefined, returnedRows = 0) {
  if (!pagination) return { complete: true, reason: null, returnedRows, limit: null, hasMore: null };
  const { hasMore, limit } = pagination;
  const reason = hasMore === false ? null : hasMore === null ? "upstream_limit" : "row_limit";
  return { complete: hasMore === false, reason, returnedRows: pagination.returnedRows, limit, hasMore };
}

export function reportContext(scope: ReportScope, options: ContextOptions, measured: Measured) {
  const { filters } = scope;
  const sourceId = filters.sourceId === "all" ? null : filters.sourceId;
  const sourceMode = scope.sourceMode ?? (sourceId ? "source" : "all_sources");
  return {
    generatedAt: new Date().toISOString(),
    tenantId: filters.tenantId,
    source: { mode: sourceMode, sourceId: sourceMode === "saved_funnel" ? null : sourceId },
    range: scope.range ? { ...scope.range, timezone: filters.timezone } : null,
    previousRange: previousRange(options.previousRange, filters.timezone),
    timezone: filters.timezone,
    timezoneOrigin: scope.timezoneOrigin,
    interval: options.interval ?? null,
    timeBasis: scope.timeBasis ?? (scope.range ? "calendar_range" : "catalog"),
    window: options.window ?? null,
    filters: appliedFilters(options.applied),
    currency: currency(options.currency),
    completeness: completeness(options.pagination, options.returnedRows),
    missingValues: measured.missingValues,
    redactedLabels: measured.redactedLabels,
  };
}

const outputRange = z.object({ startDate: z.string(), endDate: z.string(), timezone: z.string() }).nullable();

export const reportContextSchema = z.object({
  generatedAt: z.string(),
  tenantId: z.string(),
  source: z.object({ mode: z.enum(["all_sources", "source", "saved_funnel"]), sourceId: z.string().nullable() }),
  range: outputRange,
  previousRange: outputRange,
  timezone: z.string(),
  timezoneOrigin: z.enum(["explicit", "default"]),
  interval: z.string().nullable(),
  timeBasis: z.enum(["calendar_range", "rolling_window", "catalog"]),
  window: z.object({ minutes: z.number(), asOf: z.string() }).nullable(),
  filters: z.array(z.object({ name: z.string(), status: z.literal("applied"), value: z.unknown() })),
  currency: z.object({ reportingCurrency: z.string().nullable(), status: z.string(), excludedCount: z.number().nullable() }),
  completeness: z.object({
    complete: z.boolean(),
    reason: z.string().nullable(),
    returnedRows: z.number(),
    limit: z.number().nullable(),
    hasMore: z.boolean().nullable(),
  }),
  missingValues: z.array(z.object({ path: z.string(), reason: z.enum(["upstream_null", "zero_denominator"]), count: z.number() })),
  redactedLabels: z.number(),
});

export const catalogContextSchema = z.object({ generatedAt: z.string(), timeBasis: z.literal("catalog") });
