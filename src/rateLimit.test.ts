import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, createFailureCache } from './rateLimit.js';
import { AnalyticsApiError } from './analyticsApiClient.js';

test('allows up to the limit and refuses beyond it', () => {
  const rl = createRateLimiter(1000, 3);
  assert.deepEqual([rl.allow('a', 0), rl.allow('a', 0), rl.allow('a', 0), rl.allow('a', 0)], [true, true, true, false]);
});

test('keys are independent', () => {
  const rl = createRateLimiter(1000, 1);
  assert.equal(rl.allow('a', 0), true);
  assert.equal(rl.allow('b', 0), true);
  assert.equal(rl.allow('a', 0), false);
});

test('the window slides, so a caller recovers', () => {
  const rl = createRateLimiter(1000, 2);
  rl.allow('a', 0);
  rl.allow('a', 0);
  assert.equal(rl.allow('a', 500), false, 'still inside the window');
  assert.equal(rl.allow('a', 1500), true, 'window has moved past the first hits');
});

test('idle keys are pruned rather than retained forever', () => {
  const rl = createRateLimiter(1000, 5);
  for (let i = 0; i < 50; i++) rl.allow(`key-${i}`, 0);
  assert.equal(rl.size(), 50);
  rl.allow('later', 5000);
  assert.equal(rl.size(), 1, 'only the live key survives the sweep');
});

test('a rejected credential is remembered, so the upstream is not asked again', () => {
  const fc = createFailureCache(1000);
  const err = new AnalyticsApiError('signal-not-found', undefined, undefined, 401);
  fc.record('tenant-a', err, 0);
  assert.equal(fc.get('tenant-a', 500), err);
});

test('the memory expires, so a rotated credential is not locked out for long', () => {
  const fc = createFailureCache(1000);
  fc.record('tenant-a', new Error('nope'), 0);
  assert.equal(fc.get('tenant-a', 1500), undefined);
});

test('one tenant failing says nothing about another', () => {
  const fc = createFailureCache(1000);
  fc.record('tenant-a', new Error('nope'), 0);
  assert.equal(fc.get('tenant-b', 0), undefined);
});

test('the cache is bounded, so a spray of bad credentials cannot grow it forever', () => {
  const fc = createFailureCache(60_000);
  for (let i = 0; i < 10_050; i++) fc.record(`t-${i}`, new Error('nope'), 0);
  assert.ok(fc.size() <= 10_000, `expected <= 10000, got ${fc.size()}`);
});
