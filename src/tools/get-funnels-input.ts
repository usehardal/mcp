import { z } from "zod";
import { filterValue, paginationInput, reportLongValue, reportTimeInput, uniqueValues } from "./report-arguments";
import { reportScopeInput } from "./shared";

const breakdownKey = z.enum(["source", "medium", "channel", "country", "city", "device", "browser", "os"]);
const funnelStep = z.strictObject({
  stepOrder: z.number().int().min(1).max(10),
  stepType: z.enum(["event", "page"]),
  stepValue: reportLongValue,
});
const definition = z.strictObject({
  steps: z.array(funnelStep).min(2).max(10).refine(
    (steps) => steps.map((step) => step.stepOrder).sort((a, b) => a - b).every((order, index) => order === index + 1),
    "Funnel steps must be numbered consecutively from one.",
  ),
  breakdowns: z.array(z.strictObject({ breakdownKey, breakdownLabel: filterValue.optional() }))
    .max(2).refine((items) => uniqueValues(items.map((item) => item.breakdownKey)), "Breakdown keys must be unique."),
});

export const funnelsInput = z.strictObject({
  ...reportScopeInput,
  ...reportTimeInput,
  ...paginationInput,
  mode: z.enum(["list", "metadata", "saved", "preview"]).optional()
    .describe("Omit to list funnels, or to summarize a saved funnel when funnelId is supplied."),
  funnelId: z.uuid().optional(),
  definition: definition.optional(),
  breakdown: z.strictObject({
    keys: z.array(breakdownKey).max(2).refine(uniqueValues, "Breakdown keys must be unique.").optional(),
    limit: z.number().int().min(1).max(20).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
    search: filterValue.optional(),
    sortBy: z.enum(["share", "breakdown", "stepCount"]).optional(),
    sortStep: z.number().int().min(1).max(10).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }).optional(),
});
