import { ToolFailure } from "../tools/output/errors";
import { deadlineFailure } from "./tool-call";

export type AdmissionKey = { key: string; cap: number };

const inFlight = new Map<string, number>();
const waiters = new Set<() => void>();

function tryAcquire(keys: readonly AdmissionKey[]): boolean {
  if (keys.some(({ key, cap }) => (inFlight.get(key) ?? 0) >= cap)) return false;
  for (const { key } of keys) inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  return true;
}

function releaseKeys(keys: readonly AdmissionKey[]): void {
  for (const { key } of keys) {
    const count = (inFlight.get(key) ?? 0) - 1;
    if (count > 0) inFlight.set(key, count);
    else inFlight.delete(key);
  }
  const pending = [...waiters];
  waiters.clear();
  for (const notify of pending) notify();
}

function nextRelease(timeoutMs: number, signal: AbortSignal): Promise<"released" | "timeout"> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      waiters.delete(notify);
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const notify = () => {
      cleanup();
      resolve("released");
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    const onAbort = () => {
      cleanup();
      reject(deadlineFailure());
    };
    waiters.add(notify);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function busyFailure(waitMs: number): ToolFailure {
  const retryAfterSeconds = Math.max(1, Math.ceil(waitMs / 1000));
  return new ToolFailure(
    "tenant-busy",
    `Too many concurrent report requests. Retry in ${retryAfterSeconds} seconds.`,
    { retryAfterSeconds },
  );
}

export async function admitToolCall(
  keys: readonly AdmissionKey[],
  options: { waitMs: number; signal: AbortSignal },
): Promise<() => void> {
  const deadline = Date.now() + options.waitMs;
  while (!tryAcquire(keys)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw busyFailure(options.waitMs);
    const waited = await nextRelease(remaining, options.signal);
    if (waited === "timeout") throw busyFailure(options.waitMs);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseKeys(keys);
  };
}
