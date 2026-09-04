import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnalyticsApiClient } from '../analyticsApiClient.js';
import { resolveDateRange } from '../dateRange.js';

const INTERVAL_ENUM = z.enum(['minute', 'hour', 'day', 'week', 'month']);

// The API buckets the time series hourly when no interval is given, so a plain
// 30-day call comes back with ~740 points — roughly 37k tokens of response for a
// question that a daily series answers just as well. Daily is the safe default;
// callers who genuinely want finer granularity can still ask for it.
const DEFAULT_INTERVAL = 'day';

// `limit` is forwarded to the API, which applies it to the top-list sections only —
// `events` always comes back complete (203 names on a real signal). Slicing it
// client-side keeps the response bounded, and `totalEventNames` tells the caller
// how much was left out so a truncated list is never mistaken for the whole set.
const DEFAULT_LIMIT = 20;

interface NameCountVisitors {
  name: string;
  eventCount: number;
  visitors: number;
}

interface OverviewData {
  range: { startDate: string; endDate: string; timezone: string };
  events: Array<{ eventName: string; eventCount: number; sessions: number; visitors: number }>;
  summary: { totalEventCount: number; totalVisitors: number; totalSessions: number };
  topPages: Array<{ pageTitle: string; count: number; visitors: number }>;
  topReferrers: Array<{ referrerDomain: string; count: number; visitors: number }>;
  topLocations: Array<{ country: string; count: number; visitors: number }>;
  browserDistribution: NameCountVisitors[];
  deviceDistribution: NameCountVisitors[];
  osDistribution: NameCountVisitors[];
  timeSeries: Array<{
    date: string;
    eventCount: number;
    visitors: number;
    sessions: number;
    bounceRate: number;
    avgDuration: number;
  }>;
}

const nameCountVisitorsSchema = z.object({ name: z.string(), eventCount: z.number(), visitors: z.number() });

export function registerAnalyticsOverviewTool(server: McpServer, client: AnalyticsApiClient): void {
  server.registerTool(
    'get_analytics_overview',
    {
      title: 'Get Hardal Analytics Overview',
      description:
        'Fetch the aggregated analytics dashboard snapshot for a date range: summary totals, the top event names, ' +
        'top pages/referrers/locations, browser/device/OS distribution, and a time series. This is the best ' +
        'starting point for any "what happened" question — prefer it over the more specialised tools. ' +
        'Note: a wide date range at `interval: "minute"` or `"hour"` returns a very large response; leave ' +
        '`interval` unset (daily) unless the question genuinely needs finer granularity.',
      inputSchema: {
        start_date: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days before end_date.'),
        end_date: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
        timezone: z.string().optional().describe("IANA timezone. Defaults to the signal's own default."),
        event_name: z.string().optional().describe('Filter metrics to a specific event name.'),
        interval: INTERVAL_ENUM.default(DEFAULT_INTERVAL).describe(
          'Time-series bucket size. Defaults to "day". "minute"/"hour" over a wide range produce very large responses.',
        ),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(DEFAULT_LIMIT)
          .describe('Max rows per top-list section, and max event names returned. Defaults to 20.'),
        target_signal_id: z
          .string()
          .optional()
          .describe('Query a related/authorized signal instead of the default one.'),
      },
      outputSchema: {
        range: z.object({ startDate: z.string(), endDate: z.string(), timezone: z.string() }),
        events: z.array(
          z.object({ eventName: z.string(), eventCount: z.number(), sessions: z.number(), visitors: z.number() }),
        ),
        totalEventNames: z
          .number()
          .describe('How many distinct event names exist in range, before `events` was truncated to `limit`.'),
        summary: z.object({ totalEventCount: z.number(), totalVisitors: z.number(), totalSessions: z.number() }),
        topPages: z.array(z.object({ pageTitle: z.string(), count: z.number(), visitors: z.number() })),
        topReferrers: z.array(z.object({ referrerDomain: z.string(), count: z.number(), visitors: z.number() })),
        topLocations: z.array(z.object({ country: z.string(), count: z.number(), visitors: z.number() })),
        browserDistribution: z.array(nameCountVisitorsSchema),
        deviceDistribution: z.array(nameCountVisitorsSchema),
        osDistribution: z.array(nameCountVisitorsSchema),
        timeSeries: z.array(
          z.object({
            date: z.string(),
            eventCount: z.number(),
            visitors: z.number(),
            sessions: z.number(),
            bounceRate: z.number(),
            avgDuration: z.number(),
          }),
        ),
      },
    },
    async ({ start_date, end_date, timezone, event_name, interval, limit, target_signal_id }) => {
      try {
        const { start, end } = resolveDateRange({ start_date, end_date });
        const data = await client.request<OverviewData>('/analytics/overview/', {
          query: {
            timeframe: 'custom',
            startDate: start,
            endDate: end,
            timezone,
            eventName: event_name,
            interval,
            limit,
            targetSignalId: target_signal_id,
          },
        });
        const structuredContent = {
          ...data,
          events: data.events.slice(0, limit),
          totalEventNames: data.events.length,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `get_analytics_overview failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
