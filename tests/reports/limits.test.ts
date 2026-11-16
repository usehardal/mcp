import { describe, expect, it } from "bun:test";
import { admitToolCall, type AdmissionKey } from "../../src/reports/limits";
import { ToolFailure } from "../../src/tools/output/errors";

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

async function failure(promise: Promise<unknown>): Promise<ToolFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolFailure) return error;
    throw error;
  }
  throw new Error("expected a ToolFailure");
}

describe("admitToolCall", () => {
  it("admits up to the cap and lets a queued call in when a slot frees", async () => {
    const keys: AdmissionKey[] = [{ key: "tenant:queue-tenant", cap: 2 }];
    const first = await admitToolCall(keys, { waitMs: 1000, signal: liveSignal() });
    const second = await admitToolCall(keys, { waitMs: 1000, signal: liveSignal() });
    let admitted = false;
    const queued = admitToolCall(keys, { waitMs: 1000, signal: liveSignal() }).then((release) => {
      admitted = true;
      return release;
    });
    await Bun.sleep(20);
    expect(admitted).toBe(false);
    first();
    const third = await queued;
    expect(admitted).toBe(true);
    second();
    third();
  });

  it("fails with tenant-busy and a retry hint when the wait window closes", async () => {
    const keys: AdmissionKey[] = [{ key: "user:busy-user", cap: 1 }];
    const release = await admitToolCall(keys, { waitMs: 40, signal: liveSignal() });
    const error = await failure(admitToolCall(keys, { waitMs: 40, signal: liveSignal() }));
    expect(error).toMatchObject({ code: "tenant-busy", retryAfterSeconds: 1 });
    release();
    const reclaimed = await admitToolCall(keys, { waitMs: 40, signal: liveSignal() });
    reclaimed();
  });

  it("stops waiting when the tool deadline aborts", async () => {
    const keys: AdmissionKey[] = [{ key: "user:deadline-user", cap: 1 }];
    const release = await admitToolCall(keys, { waitMs: 5000, signal: liveSignal() });
    const error = await failure(admitToolCall(keys, { waitMs: 5000, signal: AbortSignal.timeout(30) }));
    expect(error.code).toBe("deadline-exceeded");
    release();
  });

  it("enforces each admission key independently", async () => {
    const keysFor = (tenant: string): AdmissionKey[] => [
      { key: "user:multi-user", cap: 2 },
      { key: `tenant:${tenant}`, cap: 1 },
    ];
    const busyTenant = await admitToolCall(keysFor("tenant-one"), { waitMs: 20, signal: liveSignal() });
    const error = await failure(admitToolCall(keysFor("tenant-one"), { waitMs: 20, signal: liveSignal() }));
    expect(error.code).toBe("tenant-busy");
    const otherTenant = await admitToolCall(keysFor("tenant-two"), { waitMs: 20, signal: liveSignal() });
    busyTenant();
    otherTenant();
  });

  it("ignores a second release of the same admission", async () => {
    const keys: AdmissionKey[] = [{ key: "user:double-release", cap: 1 }];
    const release = await admitToolCall(keys, { waitMs: 20, signal: liveSignal() });
    release();
    release();
    const first = await admitToolCall(keys, { waitMs: 20, signal: liveSignal() });
    const error = await failure(admitToolCall(keys, { waitMs: 20, signal: liveSignal() }));
    expect(error.code).toBe("tenant-busy");
    first();
  });
});
