import { describe, expect, spyOn, test } from "bun:test";
import { parseLogLevel } from "../../src/common/logger";

describe("parseLogLevel", () => {
  test("defaults to info when LOG_LEVEL is unset or empty", () => {
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("")).toBe("info");
  });

  test("accepts each known level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(parseLogLevel(level)).toBe(level);
    }
  });

  test("falls back to info and warns on an unknown level", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseLogLevel("INFO")).toBe("info");
      expect(parseLogLevel("toString")).toBe("info");
      expect(warn).toHaveBeenCalledWith(
        'LOG_LEVEL "INFO" is not one of debug, info, warn, error; using info',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
