import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { envSchema } from "../../src/config/env";

// Variables the service reads outside envSchema.
const readOutsideSchema = ["LOG_LEVEL"];

describe(".env.example", () => {
  test("lists every variable the service reads, and nothing else", () => {
    const example = readFileSync(join(import.meta.dir, "../../.env.example"), "utf8");
    const documented = [...example.matchAll(/^(?:# )?([A-Z][A-Z0-9_]*)=/gm)].map(
      (match) => match[1],
    );
    const read = [...Object.keys(envSchema.shape), ...readOutsideSchema];

    expect(documented.sort()).toEqual(read.sort());
  });
});
