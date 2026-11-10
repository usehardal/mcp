import { z } from "zod";
import { calendarDate, reportPeriod } from "./report-arguments";
import { combinedFilters } from "./report-filters";
import { reportScopeInput } from "./shared";

const comparisonInput = z.union([
  z.strictObject({ mode: z.enum(["previous_period", "previous_year"]) }),
  z.strictObject({ startDate: calendarDate, endDate: calendarDate }),
]);

export const compareInput = z.strictObject({
  ...reportScopeInput,
  report: z.enum(["overview", "acquisition"]).optional(),
  timezone: z.string().optional(),
  period: reportPeriod.optional(),
  comparison: comparisonInput.optional(),
  filters: combinedFilters.optional(),
  currentStart: calendarDate.optional(),
  currentEnd: calendarDate.optional(),
  previousStart: calendarDate.optional(),
  previousEnd: calendarDate.optional(),
});

export type ComparisonInput = z.infer<typeof comparisonInput>;
