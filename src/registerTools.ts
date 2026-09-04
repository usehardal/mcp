import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnalyticsApiClient } from './analyticsApiClient.js';
import { registerAnalyticsOverviewTool } from './tools/analyticsOverview.js';
import { registerAnalyticsEventCountsTool } from './tools/analyticsEventCounts.js';
import { registerTopCampaignsTool } from './tools/topCampaigns.js';

/**
 * Registers the full tool set on a server instance.
 *
 * Both transports go through here so that a tool can never be available over one
 * and missing over the other — the stdio entrypoint and every HTTP request build
 * their server the same way.
 *
 * Every tool here returns aggregates only. That is a deliberate boundary, not a
 * coincidence: it keeps per-visitor records out of the model's context entirely,
 * so operating this server carries no personal-data obligation of its own.
 */
export function registerAllTools(server: McpServer, client: AnalyticsApiClient): void {
  registerAnalyticsOverviewTool(server, client);
  registerAnalyticsEventCountsTool(server, client);
  registerTopCampaignsTool(server, client);
}
