import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { reportsApiRequest, type ReportsQuery } from "../reports/client";
import { openItemSelection, requireReportSettingsVersion, sealItemSelection } from "../reports/item-selection";
import { calendarKeys, calendarQuery, pickFields, rejectUnsupported } from "./report-arguments";
import { commerceFilters, commerceGroupFields, commerceSortFields, distributionQuery } from "./report-filters";
import { pagination, reportResult, reportRows, type ReportRow } from "./report-result";
import type { BreakdownInput } from "./get-breakdown-input";

const commerceRowFields = ["item_name", "sku", "item_id", "brand", "category", "price", "quantity", "coupon", "discount", "orders", "items", "revenue", "view_item_count", "add_to_cart_count", "itemCount"];
const attributionFields = ["source", "medium", "campaign", "view_item_count", "add_to_cart_count", "orders", "items", "revenue"];

function publicPage(data: ReportRow, rows: ReportRow[], limit: number, offset: number) {
  const upstreamPage = data.pagination as ReportRow | undefined;
  const total = typeof upstreamPage?.total === "number" ? upstreamPage.total : null;
  return pagination(limit, offset, rows.length, total);
}

function selectionRows(
  data: ReportRow,
  authInfo: AuthInfo | undefined,
  query: ReportsQuery,
  settingsVersion: string,
  groupBy?: BreakdownInput["groupBy"],
  filter?: ReturnType<typeof commerceFilters.parse>["filter"],
) {
  const group = commerceGroupFields.safeParse(groupBy);
  return reportRows(data.rows).map((row) => {
    if (typeof row.itemKey !== "string" || !row.itemKey || row.itemKey.length > 8192) {
      throw new Error("upstream-contract-mismatch: Commerce item has no valid selection key.");
    }
    return {
      ...pickFields(row, commerceRowFields),
      selectionId: sealItemSelection(authInfo, query, {
        key: row.itemKey, groupBy: group.data, filterField: filter?.field, filterValue: filter?.value,
        settingsVersion,
      }),
    };
  });
}

export async function commerceBreakdown(
  dimension: string,
  input: BreakdownInput,
  authInfo: AuthInfo | undefined,
) {
  const { limit = 20, offset = 0, sortDirection, selectionId } = input;
  const { query, filters } = calendarQuery(input);
  const columns = input.columns?.map((column) => commerceSortFields.parse(column));
  const sortBy = input.sortBy === undefined ? undefined : commerceSortFields.parse(input.sortBy);
  if (columns && sortBy && !columns.includes(sortBy)) {
    throw new Error("invalid-arguments: Include the Commerce sort column in columns.");
  }
  const sorting = { columns, sortBy, sortDirection };
  const baseKeys = [...calendarKeys, "limit", "offset"];
  const sortKeys = ["columns", "sortBy", "sortDirection"];
  if (dimension === "items") {
    rejectUnsupported(input, [...baseKeys, ...sortKeys, "filters", "groupBy"], "Commerce items");
    const selectionFilter = commerceFilters.parse(input.filters ?? {});
    const groupBy = input.groupBy === undefined ? undefined : commerceGroupFields.parse(input.groupBy);
    const { data, meta } = await reportsApiRequest<ReportRow>(authInfo, "/reports/commerce/items", {
      ...query, ...distributionQuery(selectionFilter), ...sorting,
      columns: columns?.join(","), groupBy, limit, offset,
    });
    const rows = selectionRows(data, authInfo, query, requireReportSettingsVersion(meta), groupBy, selectionFilter.filter);
    return reportResult({ rows, currency: data.currency, pagination: publicPage(data, rows, limit, offset) }, {
      filters, fields: { reportType: "commerce", dimension },
    });
  }

  const groupItems = dimension === "group_items";
  if (!groupItems && dimension !== "attribution") throw new Error("invalid-arguments: Unknown Commerce breakdown dimension.");
  rejectUnsupported(input, [...baseKeys, "selectionId", ...(groupItems ? sortKeys : [])], `Commerce ${dimension}`);
  if (!selectionId) throw new Error("invalid-arguments: Select a Commerce item first.");
  const item = openItemSelection(authInfo, query, selectionId);
  if (groupItems && !item.groupBy) throw new Error("invalid-arguments: Select a grouped Commerce row first.");
  const selectedFilter = { filterField: item.filterField, filterValue: item.filterValue };
  const body = groupItems
    ? { kind: "group-items", groupBy: item.groupBy, groupKey: item.key, ...selectedFilter, ...sorting, limit, offset }
    : { kind: "attribution", groupBy: item.groupBy, itemKeys: [item.key], ...selectedFilter, limit, offset };
  const { data, meta } = await reportsApiRequest<ReportRow>(authInfo, {
    method: "POST", path: "/reports/commerce/items/details", query, body,
  });
  const settingsVersion = requireReportSettingsVersion(meta);
  if (settingsVersion !== item.settingsVersion) {
    throw new Error("selection-expired: The tenant Commerce reporting settings changed. Select the item again.");
  }
  const detail = groupItems ? data : reportRows(data.items).find((entry) => entry.itemKey === item.key);
  if (!detail) throw new Error("upstream-contract-mismatch: Missing Commerce selection details.");
  const rows = groupItems
    ? selectionRows(detail, authInfo, query, settingsVersion, undefined,
      item.filterField && item.filterValue ? { field: item.filterField, value: item.filterValue } : undefined)
    : reportRows(detail.rows).map((row) => pickFields(row, attributionFields));
  return reportResult({ rows, currency: detail.currency, pagination: publicPage(detail, rows, limit, offset) }, {
    filters, fields: { reportType: "commerce", dimension },
  });
}
