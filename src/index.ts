#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfigFromEnv, ConfigError } from './config.js';
import { createAnalyticsApiClient } from './analyticsApiClient.js';
import { registerAllTools } from './registerTools.js';
import { logError } from './logger.js';

// Reads the version from package.json at runtime rather than hardcoding it a
// second time here, so the two can't drift out of sync.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfigFromEnv();
  } catch (err) {
    logError(err instanceof ConfigError ? err.message : String(err));
    process.exit(1);
  }

  const server = new McpServer({ name: 'Hardal MCP', version });
  registerAllTools(server, createAnalyticsApiClient(config));
  await server.connect(new StdioServerTransport());
  logError('Hardal MCP server running on stdio.');

  const shutdown = async (signal: string): Promise<void> => {
    logError(`Received ${signal}, shutting down.`);
    try {
      await server.close();
    } catch {
      // best-effort shutdown
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logError('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
