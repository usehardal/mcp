import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnalyticsApiClient } from '../analyticsApiClient.js';
import { resolveDateRange } from '../dateRange.js';
import { rankAndLimit } from '../rankAndLimit.js';

// No channelScore option: that was a ClickHouse-only precomputed value with no
// equivalent field on this endpoint's response.
const METRIC_ENUM = z.enum(['revenue', 'conversions', 'sessions', 'conversionRate']);

interface CampaignRow {
  campaign: string;
  source: string;
  medium: string;
  channel: string;
  conversions: number;
  revenue: number;
  sessions: number;
  conversionRate: number;
  revenuePerConversion: number;
}

interface CampaignReportData {
  data: CampaignRow[];
}

export function registerTopCampaignsTool(server: McpServer, client: AnalyticsApiClient): void {
  server.registerTool(
    'get_top_campaigns',
    {
      title: 'Get Top Hardal Campaigns',
      description:
        'Rank marketing campaigns/channels by a chosen metric over a date range, from the Analytics API Campaign Report.',
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        start_date: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days before end_date.'),
        end_date: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
        metric: METRIC_ENUM.default('revenue').describe('Which metric to rank by.'),
        limit: z.number().int().positive().max(100).default(10),
        timezone: z.string().optional().describe("IANA timezone. Defaults to the signal's own default."),
        target_signal_id: z.string().optional().describe('Query a related/authorized signal instead of the default one.'),
      },
      outputSchema: {
        rows: z.array(
          z.object({
            campaign: z.string(),
            source: z.string(),
            medium: z.string(),
            channel: z.string(),
            sessions: z.number(),
            conversions: z.number(),
            revenue: z.number(),
            conversionRate: z.number(),
            revenuePerConversion: z.number(),
          }),
        ),
      },
    },
    async ({ start_date, end_date, metric, limit, timezone, target_signal_id }) => {
      try {
        const { start, end } = resolveDateRange({ start_date, end_date });
        // No `breakdown` param: confirmed live that omitting it still returns full
        // campaign/source/medium/channel grain per row. No pagination on this
        // endpoint either, so fetch everything and rank client-side.
        const report = await client.request<CampaignReportData>('/analytics/campaign/', {
          query: {
            timeframe: 'custom',
            startDate: start,
            endDate: end,
            timezone,
            targetSignalId: target_signal_id,
          },
        });
        const rows = rankAndLimit(report.data, (row) => row[metric], limit);
        const structuredContent = { rows };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `get_top_campaigns failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
