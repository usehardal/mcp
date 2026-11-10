import { z } from "zod";
import { buildReportQuery, calendarDate, DEFAULT_TIMEFRAME, DEFAULT_TIMEZONE, timeRangeInput, type ReportInput } from "./shared";

export { calendarDate };
export const reportInterval = z.enum(["minute", "hour", "day", "week", "month"]);
export const reportPeriod = z.union([
  z.strictObject({ preset: z.enum(["today", "yesterday", "last7days", "last30days"]) }),
  z.strictObject({ startDate: calendarDate, endDate: calendarDate }),
]);
export const reportTimeInput = {
  ...timeRangeInput,
  period: reportPeriod.optional().describe("Use a calendar preset or explicit startDate and endDate."),
};
export const paginationInput = {
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
};
export const filterValue = z.string().min(1).max(255);
export const reportLongValue = z.string().min(1).max(2048);
export const reportPath = reportLongValue.regex(/^\/[^?#]*$/, "Use a path without a query or fragment.");
const reportEventName = filterValue.regex(/^(?!\s*\[)[^,]+$/, "Event names cannot contain commas or start with an opening bracket.");
export const eventNames = z.array(reportEventName).max(50).refine(uniqueValues, "Event names must be unique.");

export type CalendarRange = { startDate: string; endDate: string };
type CalendarInput = ReportInput & { period?: z.infer<typeof reportPeriod> };

export function uniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

export function pickFields<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.flatMap((key) => value[key] === undefined ? [] : [[key, value[key]]])) as Pick<T, K>;
}

export function rejectUnsupported(value: object | undefined, allowed: readonly string[], report: string): void {
  const unsupported = Object.entries(value ?? {}).filter(([key, entry]) => entry !== undefined && !allowed.includes(key));
  if (unsupported.length) {
    throw new Error(`unsupported-filter: ${unsupported.map(([key]) => key).join(", ")} is unsupported for ${report}.`);
  }
}

export const scopeKeys = ["tenantId", "sourceId"];
export const calendarKeys = [...scopeKeys, "period", "timeframe", "startDate", "endDate", "timezone"];

export function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function calendarDays(range: CalendarRange): number {
  return (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000 + 1;
}

export function validateRange(range: CalendarRange): CalendarRange {
  if (!calendarDate.safeParse(range.startDate).success || !calendarDate.safeParse(range.endDate).success || range.startDate > range.endDate) {
    throw new Error("invalid-date-range: Provide real dates with startDate on or before endDate.");
  }
  if (calendarDays(range) > 90) {
    throw new Error("range-too-large: A report period can contain at most 90 calendar days.");
  }
  return range;
}

export function resolveCalendar(input: CalendarInput, now = new Date()): CalendarRange {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw new Error("invalid-timezone: Provide a valid IANA timezone.");
  }

  const { period, timeframe, startDate, endDate } = input;
  if (period && (timeframe !== undefined || startDate !== undefined || endDate !== undefined)) {
    throw new Error("invalid-arguments: Use period or the existing timeframe and date fields.");
  }
  if (period && "startDate" in period) return validateRange(period);
  if (timeframe === "custom" || startDate !== undefined || endDate !== undefined) {
    if (!startDate || !endDate) throw new Error("Provide both startDate and endDate for a custom date range.");
    return validateRange({ startDate, endDate });
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  const today = `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day}`;
  const preset = period?.preset ?? timeframe ?? DEFAULT_TIMEFRAME;
  const days = { today: 0, yesterday: 1, last7days: 6, last30days: 29 };
  const start = shiftDays(today, -days[preset as keyof typeof days]);
  return { startDate: start, endDate: preset === "yesterday" ? start : today };
}

export function calendarQuery(input: CalendarInput) {
  const range = resolveCalendar(input);
  return { ...buildReportQuery({ ...input, ...range, timeframe: "custom" }), range };
}

export function validatePointBudget(range: CalendarRange, interval: z.infer<typeof reportInterval>, series = 1) {
  const days = calendarDays(range);
  const points = { minute: days * 1440, hour: days * 24, day: days, week: Math.ceil(days / 7) + 1, month: Math.ceil(days / 28) + 1 };
  if (points[interval] * series > 2000) {
    throw new Error("response-too-large: Choose a coarser interval or a shorter date range.");
  }
}
