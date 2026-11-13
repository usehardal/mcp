import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { logger } from "../../common/logger";

export const SCHEMA_VERSION = "1.0.0";

export const toolErrorCodes = [
  "invalid-arguments", "unsupported-filter", "invalid-date-range", "invalid-timezone", "range-too-large",
  "invalid-pagination", "access-denied", "resource-not-found", "selection-expired", "quota-exceeded",
  "upstream-unavailable", "response-too-large", "currency-unavailable", "feature-unavailable", "upstream-contract-mismatch",
] as const;
export type ToolErrorCode = (typeof toolErrorCodes)[number];

const retryableCodes: ReadonlySet<ToolErrorCode> = new Set(["quota-exceeded", "upstream-unavailable"]);
const codedMessage = /^([a-z]+(?:-[a-z]+)*): (.+)$/s;
const maxFields = 20;

export class ToolFailure extends Error {
  readonly code: ToolErrorCode;
  readonly retryAfterSeconds: number | null;
  readonly fields: readonly string[];

  constructor(
    code: ToolErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; fields?: readonly string[] } = {},
  ) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.fields = options.fields ?? [];
  }
}

function isToolErrorCode(value: string): value is ToolErrorCode {
  return (toolErrorCodes as readonly string[]).includes(value);
}

export function issueFields(error: ZodError): string[] {
  return error.issues.map((issue) => issue.path.join(".")).filter(Boolean).slice(0, maxFields);
}

export function toolFailure(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error;
  if (error instanceof ZodError) {
    return new ToolFailure("invalid-arguments", "The request arguments are invalid.", { fields: issueFields(error) });
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = codedMessage.exec(message);
  if (match && isToolErrorCode(match[1]!)) return new ToolFailure(match[1], match[2]!);
  logger.error("Tool call failed", { message });
  return new ToolFailure("upstream-contract-mismatch", "The report could not be produced.");
}

export function errorEnvelope(failure: ToolFailure) {
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      retryable: retryableCodes.has(failure.code),
      retryAfterSeconds: failure.retryAfterSeconds,
      ...(failure.fields.length ? { fields: [...failure.fields] } : {}),
    },
  };
}

export function errorResult(failure: ToolFailure): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: `${failure.code}: ${failure.message}` },
      { type: "text", text: JSON.stringify(errorEnvelope(failure)) },
    ],
  };
}
