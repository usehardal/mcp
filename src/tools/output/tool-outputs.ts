import { z } from "zod";
import { catalogContextSchema, reportContextSchema } from "./context";
import { SCHEMA_VERSION } from "./errors";

function output(context: z.ZodType) {
  return { schemaVersion: z.literal(SCHEMA_VERSION), ok: z.literal(true), context, data: z.looseObject({}) };
}

export const catalogOutput = output(catalogContextSchema);
export const reportOutput = output(reportContextSchema);
