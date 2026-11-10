import { filtersLine, type ResolvedFilters } from "./shared";

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

export function reportResult(
  report: object,
  options: { filters?: ResolvedFilters; text?: string; fields?: Record<string, unknown> } = {},
) {
  const text = options.text ?? (options.filters ? filtersLine(options.filters) : "Aggregate data only.");
  const structuredContent = {
    ...options.fields,
    ...(options.filters ? { appliedFilters: options.filters } : {}),
    report,
  };
  return toolResult(text, structuredContent);
}

export function toolResult(text: string, structuredContent: Record<string, unknown>) {
  const result = {
    content: [{ type: "text" as const, text }, { type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) {
    throw new Error("response-too-large: Narrow the date range or reduce the number of rows.");
  }
  return result;
}
