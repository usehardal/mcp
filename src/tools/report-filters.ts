import { z } from "zod";
import { eventNames, filterValue, reportPath } from "./report-arguments";
import { trafficScopeInput } from "./shared";

const commaDelimitedPathFilter = reportPath.regex(/^[^,]+$/, "Path filters for this report cannot contain commas.").optional();
const maxAcquisitionEventMetrics = 10;

export const overviewFilterFields = {
  path: commaDelimitedPathFilter,
  channel: filterValue.optional(),
  source: filterValue.optional(),
  device: filterValue.optional(),
  os: filterValue.optional(),
  country: filterValue.optional(),
  city: filterValue.optional(),
  eventName: filterValue.optional(),
};
export const aiPageReportFilters = z.strictObject({
  isAi: z.boolean().optional(),
  pagePath: reportPath.optional(),
});
export const aiFilterFields = {
  ...aiPageReportFilters.shape,
  agentType: filterValue.optional(),
  agentName: filterValue.optional(),
  agentPlatform: filterValue.optional(),
  agentCategory: filterValue.optional(),
};
export const overviewFilters = z.strictObject(overviewFilterFields);
export const aiFilters = z.strictObject({ ...aiFilterFields, pagePath: commaDelimitedPathFilter });
export const acquisitionFilterFields = {
  attributionModel: z.enum(["first_touch", "last_touch", "last_non_direct_touch"]).optional(),
  attributionWindowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional(),
  trafficScope: trafficScopeInput,
  conversionEventNames: eventNames.optional(),
  eventMetricNames: eventNames.max(maxAcquisitionEventMetrics).optional(),
  aiFocus: z.boolean().optional(),
};
export const acquisitionDistributionFields = z.enum(["source", "medium", "campaign", "channel"]);
export const commerceGroupFields = z.enum(["item_name", "item_id", "brand", "category", "price", "quantity", "coupon", "discount"]);
export const commerceFilterFields = z.enum(["item_name", "item_id", "brand", "category", "coupon"]);
export const filterSelection = z.strictObject({
  field: z.union([acquisitionDistributionFields, commerceFilterFields]),
  value: filterValue,
});
export const acquisitionFilters = z.strictObject({
  ...acquisitionFilterFields,
  filter: z.strictObject({ field: acquisitionDistributionFields, value: filterValue }).optional(),
});
export const commerceFilters = z.strictObject({
  filter: z.strictObject({ field: commerceFilterFields, value: filterValue }).optional(),
});
export const combinedFilters = z.strictObject({
  ...overviewFilterFields,
  ...aiFilterFields,
  ...acquisitionFilterFields,
  filter: filterSelection.optional(),
});
export const sortDirection = z.enum(["asc", "desc"]);
export const acquisitionSortFields = z.enum([
  ...acquisitionDistributionFields.options, "sessions", "conversions", "conversion_rate",
  "bounce_rate", "revenue", "revenue_per_conversion", "event_metric",
]);
export const commerceSortFields = z.enum([
  ...commerceGroupFields.options, "view_item_count", "add_to_cart_count", "orders", "items", "revenue",
]);

export function distributionQuery<T extends { filter?: { field: string; value: string } }>(input: T) {
  const { filter, ...fields } = input;
  return {
    ...fields,
    ...(filter ? { filterField: filter.field, filterValue: filter.value } : {}),
  };
}

const acquisitionControlKeys = [
  "attributionModel", "attributionWindowDays", "trafficScope", "conversionEventNames", "eventMetricNames", "aiFocus", "filter",
  "breakdownMode", "campaignsBreakdownMode", "groupBy", "columns", "sortBy", "sortEventMetricName", "sortDirection",
] as const;

export function appliedAcquisitionControls(requested: Record<string, unknown>, controls: unknown): Record<string, unknown> {
  const effective = controls && typeof controls === "object" ? (controls as Record<string, unknown>) : {};
  const applied = { ...requested };
  for (const key of acquisitionControlKeys) {
    if (effective[key] !== undefined && effective[key] !== null) applied[key] = effective[key];
  }
  return applied;
}

export function acquisitionQuery(input: z.infer<typeof acquisitionFilters>) {
  return {
    ...distributionQuery(input),
    conversionEventNames: input.conversionEventNames?.length === 0 ? "" : input.conversionEventNames,
  };
}
