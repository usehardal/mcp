export class ConfigError extends Error {}

export interface HardalConfig {
  analytics: {
    baseUrl: string;
    signalId: string;
    signalToken: string;
  };
  requestTimeoutMs: number;
}

const DEFAULT_API_BASE_URL = 'https://api.nexus.usehardal.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parsePositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`Environment variable ${key} must be a positive integer, got: "${raw}"`);
  }
  return parsed;
}

/**
 * Loads and validates config from environment variables.
 * Pure and synchronous — never calls process.exit, so it stays unit-testable.
 * The caller (index.ts) is responsible for catching ConfigError and exiting.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HardalConfig {
  const signalId = requireNonEmpty(env, 'HARDAL_SIGNAL_ID');
  const signalToken = requireNonEmpty(env, 'HARDAL_SIGNAL_TOKEN');
  const requestTimeoutMs = parsePositiveInt(env, 'HARDAL_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS);

  let baseUrl = DEFAULT_API_BASE_URL;
  const rawBaseUrl = env.HARDAL_API_BASE_URL;
  if (rawBaseUrl && rawBaseUrl.trim() !== '') {
    try {
      // eslint-disable-next-line no-new
      new URL(rawBaseUrl);
    } catch {
      throw new ConfigError(`HARDAL_API_BASE_URL is not a valid URL: "${rawBaseUrl}"`);
    }
    baseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
  }

  return {
    analytics: { baseUrl, signalId, signalToken },
    requestTimeoutMs,
  };
}
