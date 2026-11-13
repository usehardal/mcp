import type { z } from "zod";
import { ToolFailure, issueFields } from "./errors";

export type MissingValue = { path: string; reason: "upstream_null" | "zero_denominator"; count: number };

const pathLike = /^(?:\/|https?:\/\/)/;
const serverOwnedKeys = new Set(["pagination", "topPagesPagination"]);

export function shape<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ToolFailure("upstream-contract-mismatch", "The report context could not be built.", {
    fields: issueFields(parsed.error),
  });
}

export function normalizePaths<T>(value: T): { value: T; redacted: number } {
  let redacted = 0;
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const cut = pathLike.test(node) ? node.search(/[?#]/) : -1;
      if (cut === -1) return node;
      redacted += 1;
      return node.slice(0, cut);
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, entry]) => [key, visit(entry)]));
    }
    return node;
  };
  return { value: visit(value) as T, redacted };
}

function pointerSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function nullPointers(value: unknown, base = "/data"): MissingValue[] {
  const pointers = new Map<string, MissingValue>();
  const visit = (node: unknown, path: string, reason: MissingValue["reason"]) => {
    if (node === null) {
      const entry = pointers.get(path) ?? { path, reason, count: 0 };
      entry.count += 1;
      pointers.set(path, entry);
    } else if (Array.isArray(node)) {
      for (const entry of node) visit(entry, `${path}/*`, reason);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      const scoped = record.reason === "previous-zero" ? "zero_denominator" : reason;
      for (const [key, entry] of Object.entries(record)) {
        if (!serverOwnedKeys.has(key)) visit(entry, `${path}/${pointerSegment(key)}`, scoped);
      }
    }
  };
  visit(value, base, "upstream_null");
  return [...pointers.values()];
}
