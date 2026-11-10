import { z } from "zod";
import { eventNames, filterValue, paginationInput, reportInterval, reportTimeInput } from "./report-arguments";
import { reportScopeInput } from "./shared";

export const eventInput = z.strictObject({
  ...reportScopeInput,
  ...reportTimeInput,
  ...paginationInput,
  mode: z.enum(["overview", "options"]).optional(),
  target: z.enum(["acquisition", "commerce", "funnel"]).optional(),
  search: filterValue.optional(),
  interval: reportInterval.optional(),
  metricEventNames: eventNames.optional(),
  conversionEventNames: eventNames.min(1).optional(),
  timeline: z.strictObject({ mode: z.enum(["include", "exclude"]), eventNames }).optional(),
  metricsOnly: z.boolean().optional(),
});
