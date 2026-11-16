import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../../src/config";
import { awaitWithDeadline, runToolCall, toolCallContext } from "../../src/reports/tool-call";
import { ToolFailure } from "../../src/tools/output/errors";

const configuredDeadline = config.reports.toolDeadlineMs;

afterEach(() => {
  config.reports.toolDeadlineMs = configuredDeadline;
});

describe("runToolCall", () => {
  it("exposes the call context inside the run and not outside", async () => {
    expect(toolCallContext()).toBeUndefined();
    await runToolCall({ tenantId: "context-tenant" }, async (context) => {
      expect(toolCallContext()).toBe(context);
      expect(context.tenantId).toBe("context-tenant");
      expect(context.upstreamRequests).toBe(0);
      expect(context.exchanges).toBe(0);
      expect(context.signal.aborted).toBe(false);
    });
    expect(toolCallContext()).toBeUndefined();
  });

  it("resolves work that finishes inside the budget", async () => {
    config.reports.toolDeadlineMs = 1000;
    const value = await runToolCall({}, () => awaitWithDeadline(Promise.resolve("done")));
    expect(value).toBe("done");
  });

  it("rejects a pending upstream wait once the budget is spent", async () => {
    config.reports.toolDeadlineMs = 1000;
    const pending = new Promise(() => undefined);
    const error = await runToolCall({}, () =>
      awaitWithDeadline(pending).then(
        () => undefined,
        (failure: unknown) => failure,
      ));
    expect(error).toBeInstanceOf(ToolFailure);
    expect((error as ToolFailure).code).toBe("deadline-exceeded");
  }, 3000);

  it("passes a promise through when no tool call is active", async () => {
    expect(await awaitWithDeadline(Promise.resolve(7))).toBe(7);
  });
});
