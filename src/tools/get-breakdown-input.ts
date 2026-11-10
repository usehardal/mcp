import { z } from "zod";
import { itemSelectionId } from "../reports/item-selection";
import { filterValue, paginationInput, reportInterval, reportPath, reportTimeInput, uniqueValues } from "./report-arguments";
import {
  acquisitionDistributionFields, acquisitionSortFields, combinedFilters,
  commerceGroupFields, commerceSortFields, sortDirection,
} from "./report-filters";
import { reportScopeInput, trafficScopeInput } from "./shared";

export const acquisitionDimensions = ["channels", "campaigns", "source", "medium"] as const;
export const overviewDimensions = ["channels", "sources", "countries", "cities", "devices", "browsers", "operating_systems", "pages"] as const;
export const pagesDimensions = ["top", "attribution", "entry", "exit", "flow"] as const;
export const aiGraphDimensions = ["agentName", "agentPlatform", "agentCategory", "pagePath"] as const;
const commerceDimensions = ["items", "group_items", "attribution"] as const;

const columns = z.union([
  acquisitionSortFields.exclude(["event_metric"]),
  commerceSortFields,
]);

export const breakdownInput = z.strictObject({
  ...reportScopeInput,
  ...reportTimeInput,
  ...paginationInput,
  mode: z.enum(["data", "options"]).optional().describe("Use options with target to discover supported filter values."),
  report: z.enum(["overview", "acquisition", "pages", "commerce", "ai_visibility"]).optional()
    .describe("Report family. Overview supports geographic and device dimensions, Pages supports top, attribution, entry, exit and flow."),
  target: z.enum(["ai_visibility", "funnel_pages", "funnel_breakdowns"]).optional(),
  dimension: z.enum([
    ...new Set([
      ...acquisitionDimensions, ...overviewDimensions, ...pagesDimensions, ...aiGraphDimensions,
      ...commerceDimensions, "pageAgent", "agentType", "acquisition", "events",
    ]),
  ]).optional(),
  filters: combinedFilters.optional(),
  trafficScope: trafficScopeInput,
  interval: reportInterval.optional(),
  steps: z.number().int().min(2).max(5).optional(),
  destinationPath: reportPath.optional(),
  pageLimit: paginationInput.limit.describe("Number of Top Pages in a Pages attribution page."),
  pageOffset: paginationInput.offset.describe("Top Pages offset for attribution. The offset field pages attribution rows within those pages."),
  search: filterValue.optional(),
  groupBy: z.union([z.literal("none"), acquisitionDistributionFields, commerceGroupFields]).optional(),
  columns: z.array(columns).min(1).max(13).refine(uniqueValues, "Columns must be unique.").optional(),
  sortBy: z.union([acquisitionSortFields, commerceSortFields]).optional(),
  sortEventMetricName: filterValue.optional(),
  sortDirection: sortDirection.optional(),
  selectionId: itemSelectionId.optional()
    .describe("Use the selectionId from Commerce items for attribution or group_items with the same tenant, source, dates and timezone."),
});

export type BreakdownInput = z.infer<typeof breakdownInput>;
