/**
 * Shared start/end date defaulting and validation for the get_top_campaigns and
 * get_revenue_trend convenience tools.
 */
export class DateRangeError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DateRangeInput {
  start_date?: string;
  end_date?: string;
}

export interface ResolvedDateRange {
  start: string;
  end: string;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string, label: string): Date {
  if (!DATE_RE.test(value)) {
    throw new DateRangeError(`${label} must be in YYYY-MM-DD format, got: "${value}"`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  // Node's Date parser silently rolls over out-of-range days/months (e.g. "2026-02-30"
  // becomes March 2nd) instead of rejecting them. Round-tripping back to a string and
  // comparing catches that rollover as well as outright NaN results (e.g. month 13).
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== value) {
    throw new DateRangeError(`${label} is not a valid calendar date: "${value}"`);
  }
  return parsed;
}

/** Defaults to the last 30 days (ending today) when start_date/end_date are unset. */
export function resolveDateRange(input: DateRangeInput = {}, now: Date = new Date()): ResolvedDateRange {
  const end = input.end_date ? parseDate(input.end_date, 'end_date') : now;
  const start = input.start_date
    ? parseDate(input.start_date, 'start_date')
    : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);

  if (start.getTime() > end.getTime()) {
    throw new DateRangeError(`start_date (${formatDate(start)}) must not be after end_date (${formatDate(end)}).`);
  }

  return { start: formatDate(start), end: formatDate(end) };
}
