import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDateRange, DateRangeError } from './dateRange.js';

const FIXED_NOW = new Date('2026-07-08T12:34:56.000Z');

test('defaults to the last 30 days ending today when both are unset', () => {
  const range = resolveDateRange({}, FIXED_NOW);
  assert.equal(range.end, '2026-07-08');
  assert.equal(range.start, '2026-06-08');
});

test('defaults end_date to today when only start_date is given', () => {
  const range = resolveDateRange({ start_date: '2026-01-01' }, FIXED_NOW);
  assert.equal(range.start, '2026-01-01');
  assert.equal(range.end, '2026-07-08');
});

test('defaults start_date to 30 days before end_date when only end_date is given', () => {
  const range = resolveDateRange({ end_date: '2026-02-15' }, FIXED_NOW);
  assert.equal(range.end, '2026-02-15');
  assert.equal(range.start, '2026-01-16');
});

test('accepts explicit start_date and end_date', () => {
  const range = resolveDateRange({ start_date: '2026-01-01', end_date: '2026-01-31' }, FIXED_NOW);
  assert.deepEqual(range, { start: '2026-01-01', end: '2026-01-31' });
});

test('accepts a valid leap-day date (2028 is a leap year)', () => {
  const range = resolveDateRange({ start_date: '2028-02-29', end_date: '2028-03-01' }, FIXED_NOW);
  assert.equal(range.start, '2028-02-29');
});

test('rejects a non-leap-year Feb 29 (2026 is not a leap year)', () => {
  assert.throws(() => resolveDateRange({ start_date: '2026-02-29' }, FIXED_NOW), DateRangeError);
});

test('rejects an out-of-range day of month', () => {
  assert.throws(() => resolveDateRange({ start_date: '2026-02-30' }, FIXED_NOW), DateRangeError);
});

test('rejects an out-of-range month', () => {
  assert.throws(() => resolveDateRange({ start_date: '2026-13-01' }, FIXED_NOW), DateRangeError);
});

test('rejects a malformed date string', () => {
  assert.throws(() => resolveDateRange({ start_date: '01/01/2026' }, FIXED_NOW), DateRangeError);
});

test('rejects start_date after end_date', () => {
  assert.throws(
    () => resolveDateRange({ start_date: '2026-02-01', end_date: '2026-01-01' }, FIXED_NOW),
    DateRangeError,
  );
});

test('accepts start_date equal to end_date', () => {
  const range = resolveDateRange({ start_date: '2026-01-01', end_date: '2026-01-01' }, FIXED_NOW);
  assert.deepEqual(range, { start: '2026-01-01', end: '2026-01-01' });
});
