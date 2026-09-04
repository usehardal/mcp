import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfigFromEnv, ConfigError } from './config.js';

const BASE_ENV = {
  HARDAL_SIGNAL_ID: 'test-signal-id',
  HARDAL_SIGNAL_TOKEN: 'a-signal-token',
};

test('succeeds with all required vars, applies defaults', () => {
  const config = loadConfigFromEnv({ ...BASE_ENV });
  assert.equal(config.analytics.baseUrl, 'https://api.nexus.usehardal.com');
  assert.equal(config.analytics.signalId, 'test-signal-id');
  assert.equal(config.analytics.signalToken, 'a-signal-token');
  assert.equal(config.requestTimeoutMs, 30_000);
});

test('throws ConfigError when HARDAL_SIGNAL_ID is missing', () => {
  const { HARDAL_SIGNAL_ID, ...rest } = BASE_ENV;
  assert.throws(() => loadConfigFromEnv({ ...rest }), ConfigError);
});

test('throws ConfigError when HARDAL_SIGNAL_TOKEN is missing', () => {
  const { HARDAL_SIGNAL_TOKEN, ...rest } = BASE_ENV;
  assert.throws(() => loadConfigFromEnv({ ...rest }), ConfigError);
});

test('honors a custom HARDAL_API_BASE_URL and strips a trailing slash', () => {
  const config = loadConfigFromEnv({
    ...BASE_ENV,
    HARDAL_API_BASE_URL: 'https://staging.example.com/',
  });
  assert.equal(config.analytics.baseUrl, 'https://staging.example.com');
});

test('throws ConfigError on a malformed HARDAL_API_BASE_URL', () => {
  assert.throws(
    () => loadConfigFromEnv({ ...BASE_ENV, HARDAL_API_BASE_URL: 'not-a-url' }),
    ConfigError,
  );
});

test('honors a custom HARDAL_REQUEST_TIMEOUT_MS', () => {
  const config = loadConfigFromEnv({ ...BASE_ENV, HARDAL_REQUEST_TIMEOUT_MS: '5000' });
  assert.equal(config.requestTimeoutMs, 5000);
});

test('throws ConfigError when HARDAL_REQUEST_TIMEOUT_MS is not a positive integer', () => {
  assert.throws(
    () => loadConfigFromEnv({ ...BASE_ENV, HARDAL_REQUEST_TIMEOUT_MS: 'not-a-number' }),
    ConfigError,
  );
  assert.throws(
    () => loadConfigFromEnv({ ...BASE_ENV, HARDAL_REQUEST_TIMEOUT_MS: '-1' }),
    ConfigError,
  );
});
