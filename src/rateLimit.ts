/**
 * In-process rate limiting for the HTTP transport.
 *
 * Deliberately in-memory and therefore **per replica**: with N replicas the
 * effective limit is N times the configured one. That is an accepted trade-off —
 * a shared store would reintroduce the cross-request state the stateless design
 * exists to avoid. These limits exist to stop this server being used to hammer
 * the Analytics API, not to be an exact quota. Put an edge (Cloudflare, Front
 * Door) in front if a precise limit is ever needed.
 */

export interface RateLimiter {
  /** Records a hit and reports whether it is within the limit. */
  allow(key: string, now?: number): boolean;
  /** Number of keys currently tracked; used to prove pruning works. */
  size(): number;
}

export function createRateLimiter(windowMs: number, max: number): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastPrune = 0;

  function prune(now: number): void {
    // Amortised: sweep at most once per window rather than on every request, so a
    // burst doesn't turn into a quadratic scan of every tracked key.
    if (now - lastPrune < windowMs) return;
    lastPrune = now;
    for (const [key, times] of hits) {
      const live = times.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return {
    allow(key: string, now = Date.now()): boolean {
      prune(now);
      const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      times.push(now);
      hits.set(key, times);
      return times.length <= max;
    },
    size: () => hits.size,
  };
}

/**
 * Remembers credentials the Analytics API has already rejected, so a repeat of a
 * known-bad pair is refused locally instead of becoming another upstream login.
 *
 * Only outright rejections are remembered. A timeout or a 5xx is a fact about the
 * upstream's health, not about the credentials, and caching it would lock out a
 * legitimate customer for the whole window over a transient blip.
 */
export interface FailureCache {
  get(key: string, now?: number): Error | undefined;
  record(key: string, error: Error, now?: number): void;
  size(): number;
}

export function createFailureCache(ttlMs: number): FailureCache {
  const failures = new Map<string, { error: Error; at: number }>();

  return {
    get(key, now = Date.now()) {
      const hit = failures.get(key);
      if (!hit) return undefined;
      if (now - hit.at >= ttlMs) {
        failures.delete(key);
        return undefined;
      }
      return hit.error;
    },
    record(key, error, now = Date.now()) {
      // Bounded so a spray of distinct bad credentials cannot grow this without
      // limit; oldest entry goes first, and losing one only costs one upstream call.
      if (failures.size >= 10_000) {
        const oldest = failures.keys().next();
        if (!oldest.done) failures.delete(oldest.value);
      }
      failures.set(key, { error, at: now });
    },
    size: () => failures.size,
  };
}
