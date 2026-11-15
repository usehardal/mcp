import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config";
import { ToolFailure } from "../tools/output/errors";

export type ToolCallContext = {
  signal: AbortSignal;
  tenantId?: string;
  upstreamRequests: number;
  exchanges: number;
};

const storage = new AsyncLocalStorage<ToolCallContext>();

export function deadlineFailure(): ToolFailure {
  return new ToolFailure(
    "deadline-exceeded",
    "The report took longer than the per-call time budget. Retry, or narrow the date range.",
  );
}

export function runToolCall<T>(
  options: { tenantId?: string },
  run: (context: ToolCallContext) => Promise<T>,
): Promise<T> {
  const context: ToolCallContext = {
    signal: AbortSignal.timeout(config.reports.toolDeadlineMs),
    tenantId: options.tenantId,
    upstreamRequests: 0,
    exchanges: 0,
  };
  return storage.run(context, () => run(context));
}

export function toolCallContext(): ToolCallContext | undefined {
  return storage.getStore();
}

export async function awaitWithDeadline<T>(promise: Promise<T>): Promise<T> {
  const context = storage.getStore();
  if (!context) return promise;
  if (context.signal.aborted) {
    promise.catch(() => undefined);
    throw deadlineFailure();
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(deadlineFailure());
    context.signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => context.signal.removeEventListener("abort", onAbort));
  });
}
