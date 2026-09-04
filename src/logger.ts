// stdout is the MCP JSON-RPC transport channel over stdio — anything written there
// corrupts the protocol stream. All logging must go to stderr instead.

const PREFIX = '[Hardal MCP]';

export function log(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}

export function logError(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
