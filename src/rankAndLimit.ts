/**
 * Client-side sort-and-slice for endpoints that don't expose a server-side
 * sort-by-metric param (Campaign Report, Overview's topPages).
 */
export function rankAndLimit<T>(rows: T[], metricValue: (row: T) => number, limit: number): T[] {
  return [...rows].sort((a, b) => metricValue(b) - metricValue(a)).slice(0, limit);
}
