import { z } from "zod";
import { eventNames, reportInterval, reportPath, reportTimeInput, uniqueValues } from "./report-arguments";
import { aiFilterFields, overviewFilterFields } from "./report-filters";
import { reportScopeInput } from "./shared";

export const overviewInput = z.strictObject({
  ...reportScopeInput,
  ...reportTimeInput,
  report: z.enum(["overview", "realtime", "pages", "page_trends", "sessions", "commerce", "ai_visibility"]).optional(),
  filters: z.strictObject({ ...overviewFilterFields, ...aiFilterFields }).optional(),
  interval: reportInterval.optional(),
  windowMinutes: z.number().int().min(1).max(60).optional(),
  includeTrend: z.boolean().optional(),
  engagedEventNames: eventNames.optional(),
  pagePaths: z.array(reportPath).min(1).max(8).refine(uniqueValues, "Page paths must be unique.").optional(),
  pagePathLimit: z.number().int().min(1).max(50).optional(),
  pagePathOffset: z.number().int().min(0).max(10_000).optional(),
});
