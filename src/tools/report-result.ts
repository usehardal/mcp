export type ReportRow = Record<string, unknown>;

export function reportRows(value: unknown): ReportRow[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("upstream-contract-mismatch: Expected a list of report rows.");
  }
  return value;
}

export function pagination(limit: number, offset: number, returnedRows: number, total: number | null) {
  const hasMore = total === null ? null : offset + returnedRows < total;
  return { limit, offset, returnedRows, total, hasMore, truncated: hasMore !== false };
}

export function pageRows(rows: ReportRow[], limit = 20, offset = 0, complete = true) {
  const page = rows.slice(offset, offset + limit);
  const details = pagination(limit, offset, page.length, complete ? rows.length : null);
  if (!complete && offset + page.length < rows.length) details.hasMore = true;
  return { rows: page, pagination: details };
}

export function extendPagination(upstream: unknown, returnedRows: number, fallback: { limit: number; offset: number }) {
  const page = (upstream ?? {}) as ReportRow;
  const limit = typeof page.limit === "number" ? page.limit : fallback.limit;
  const offset = typeof page.offset === "number" ? page.offset : fallback.offset;
  return pagination(limit, offset, returnedRows, typeof page.total === "number" ? page.total : null);
}
