import { createHash } from "node:crypto";
import { exchangeForReportsApiToken, type DelegatedToken } from "./token-exchange";

const MAX_TTL_MS = 4 * 60_000;
const EXPIRY_MARGIN_MS = 30_000;
const SWEEP_INTERVAL_MS = 60_000;

type CacheEntry = { token: DelegatedToken; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<DelegatedToken>>();
let nextSweepAt = 0;

function cacheKey(subjectToken: string): string {
  return createHash("sha256").update(subjectToken).digest("base64");
}

function sweep(now: number): void {
  if (now < nextSweepAt) return;
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) cache.delete(key);
  }
  nextSweepAt = now + SWEEP_INTERVAL_MS;
}

export async function exchangeReportsApiToken(subjectToken: string): Promise<DelegatedToken> {
  const key = cacheKey(subjectToken);
  const now = Date.now();
  sweep(now);

  const cached = cache.get(key);
  if (cached && now < cached.expiresAt) return cached.token;
  cache.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const exchange = exchangeForReportsApiToken(subjectToken)
    .then((token) => {
      const ttlMs = Math.min(token.expiresInSeconds * 1000 - EXPIRY_MARGIN_MS, MAX_TTL_MS);
      if (ttlMs > 0) cache.set(key, { token, expiresAt: Date.now() + ttlMs });
      return token;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, exchange);
  return exchange;
}

export function resetExchangeCache(): void {
  cache.clear();
  inFlight.clear();
  nextSweepAt = 0;
}
