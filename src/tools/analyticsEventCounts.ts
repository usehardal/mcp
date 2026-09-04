import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AnalyticsApiClient } from '../analyticsApiClient.js';
import { resolveDateRange } from '../dateRange.js';

const INTERVAL_ENUM = z.enum(['minute', 'hour', 'day', 'week', 'month']);

// The endpoint takes no limit of its own and returns every distinct event name in
// range (203 on a real signal, ~6k tokens). Rows arrive already sorted by count
// descending, so slicing keeps the useful head and drops the long tail; the
// untruncated count travels alongside as `totalEventNames`.
const DEFAULT_LIMIT = 50;

interface EventCountRow {
  eventName: string;
  eventCount: number;
  sessions: number;
  visitors: number;
}

export function registerAnalyticsEventCountsTool(server: McpServer, client: AnalyticsApiClient): void {
  server.registerTool(
    'get_analytics_event_counts',
    {
      title: 'Get Hardal Analytics Event Counts',
      description:
        'Fetch aggregated event counts (event count, sessions, visitors) per event name over a date range, ' +
        'sorted by count descending. Use this to answer "which events fire, and how often" — for a broad ' +
        'overview of a period, `get_analytics_overview` is usually the better first call.',
      inputSchema: {
        start_date: z.string().optional().describe('YYYY-MM-DD. Defaults to 30 days before end_date.'),
        end_date: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
        timezone: z.string().optional().describe("IANA timezone. Defaults to the signal's own default."),
        event_name: z.string().optional().describe('Filter metrics to a specific event name.'),
        selected_events: z.array(z.string()).optional().describe('Only include these event names.'),
        excluded_events: z.array(z.string()).optional().describe('Exclude these event names.'),
        interval: INTERVAL_ENUM.optional().describe('Aggregation interval.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .default(DEFAULT_LIMIT)
          .describe('Max event names to return, highest count first. Defaults to 50.'),
        target_signal_id: z
          .string()
          .optional()
          .describe('Query a related/authorized signal instead of the default one.'),
      },
      outputSchema: {
        rows: z.array(
          z.object({ eventName: z.string(), eventCount: z.number(), sessions: z.number(), visitors: z.number() }),
        ),
        totalEventNames: z
          .number()
          .describe('How many distinct event names exist in range, before `rows` was truncated to `limit`.'),
      },
    },
    async ({
      start_date,
      end_date,
      timezone,
      event_name,
      selected_events,
      excluded_events,
      interval,
      limit,
      target_signal_id,
    }) => {
      try {
        const { start, end } = resolveDateRange({ start_date, end_date });
        const rows = await client.request<EventCountRow[]>('/analytics/events/counts', {
          query: {
            timeframe: 'custom',
            startDate: start,
            endDate: end,
            timezone,
            eventName: event_name,
            selectedEvents: selected_events,
            notSelectedEvents: excluded_events,
            interval,
            targetSignalId: target_signal_id,
          },
        });
        const structuredContent = { rows: rows.slice(0, limit), totalEventNames: rows.length };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `get_analytics_event_counts failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
