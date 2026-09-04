import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankAndLimit } from './rankAndLimit.js';

test('sorts descending by the given metric', () => {
  const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
  assert.deepEqual(rankAndLimit(rows, (r) => r.v, 10), [{ v: 3 }, { v: 2 }, { v: 1 }]);
});

test('slices to the requested limit', () => {
  const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
  assert.deepEqual(rankAndLimit(rows, (r) => r.v, 2), [{ v: 3 }, { v: 2 }]);
});

test('preserves relative order for tied values', () => {
  const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'c', v: 1 }];
  assert.deepEqual(
    rankAndLimit(rows, (r) => r.v, 10).map((r) => r.id),
    ['a', 'b', 'c'],
  );
});

test('returns everything when limit >= length', () => {
  const rows = [{ v: 1 }, { v: 2 }];
  assert.deepEqual(rankAndLimit(rows, (r) => r.v, 100), [{ v: 2 }, { v: 1 }]);
});

test('handles an empty array', () => {
  assert.deepEqual(rankAndLimit<{ v: number }>([], (r) => r.v, 10), []);
});

test('does not mutate the input array', () => {
  const rows = [{ v: 1 }, { v: 2 }];
  const copy = [...rows];
  rankAndLimit(rows, (r) => r.v, 10);
  assert.deepEqual(rows, copy);
});
