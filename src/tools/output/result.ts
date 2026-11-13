import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../../common/logger";
import { filtersLine, type ResolvedFilters } from "../shared";
import { reportContext, reportContextSchema, type ContextOptions, type ReportScope } from "./context";
import { normalizePaths, nullPointers, shape } from "./data";
import { SCHEMA_VERSION, ToolFailure, errorResult, toolFailure } from "./errors";

const maxOutputBytes = 256 * 1024;

export function envelope(text: string, context: object, data: object): CallToolResult {
  const structuredContent = { schemaVersion: SCHEMA_VERSION, ok: true, context, data };
  const result: CallToolResult = {
    content: [{ type: "text", text }, { type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > maxOutputBytes) {
    throw new ToolFailure("response-too-large", "Narrow the date range or reduce the number of rows.");
  }
  return result;
}

function finish(
  text: string,
  data: object,
  scope: ReportScope,
  context: ContextOptions,
  upstream: (shaped: Record<string, unknown>) => unknown,
  base: string,
): CallToolResult {
  const shaped = normalizePaths(data);
  const applied = normalizePaths(context.applied ?? {});
  const measured = {
    missingValues: nullPointers(upstream(shaped.value as Record<string, unknown>), base),
    redactedLabels: shaped.redacted + applied.redacted,
  };
  const reportOptions = { ...context, applied: applied.value };
  return envelope(text, shape(reportContextSchema, reportContext(scope, reportOptions, measured)), shaped.value);
}

export function toolResult(text: string, data: object, scope: ReportScope, context: ContextOptions = {}): CallToolResult {
  return finish(text, data, scope, context, (shaped) => shaped, "/data");
}

export function reportResult(
  report: object,
  options: {
    scope: ReportScope;
    filters?: ResolvedFilters;
    text?: string;
    fields?: Record<string, unknown>;
    context?: ContextOptions;
  },
): CallToolResult {
  const text = options.text ?? (options.filters ? filtersLine(options.filters) : "Aggregate data only.");
  const data = {
    ...options.fields,
    ...(options.filters ? { appliedFilters: options.filters } : {}),
    report,
  };
  return finish(text, data, options.scope, options.context ?? {}, (shaped) => shaped.report, "/data/report");
}

export function guard<Args extends ZodRawShapeCompat | AnySchema>(handler: ToolCallback<Args>): ToolCallback<Args> {
  const call = handler as (...params: unknown[]) => CallToolResult | Promise<CallToolResult>;
  const guarded = async (...params: unknown[]): Promise<CallToolResult> => {
    try {
      return await call(...params);
    } catch (error) {
      const failure = toolFailure(error);
      if (failure.code === "upstream-unavailable") logger.warn("Upstream report request failed", { code: failure.code, message: failure.message });
      return errorResult(failure);
    }
  };
  return guarded as unknown as ToolCallback<Args>;
}
