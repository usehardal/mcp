import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server";
import * as reportsClient from "../../src/reports/client";
import type { ReportRow } from "../../src/tools/report-result";

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: { ok: boolean; data: Record<string, any> };
};

const tenantId = "11111111-1111-4111-8111-111111111111";
const period = { startDate: "2026-11-09", endDate: "2026-11-15" };
const range = { ...period, timezone: "Europe/Istanbul" };
const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

let upstream: Record<string, unknown>;
let single: Mock<typeof reportsClient.reportsApiRequest>;
let many: Mock<typeof reportsClient.reportsApiRequests>;
let consoleSpies: Array<Mock<typeof console.error>> = [];

function fixture(request: reportsClient.ReportRequest | string) {
  const path = typeof request === "string" ? request : request.path;
  if (!(path in upstream)) throw new Error(`No fixture for ${path}`);
  return { data: structuredClone(upstream[path]) as ReportRow };
}

async function call(name: string, args: Record<string, unknown>) {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dashboard-parity-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await client.callTool({ name, arguments: args }) as ToolResult;
  } finally {
    await client.close();
    await server.close();
  }
}

beforeEach(() => {
  upstream = {};
  consoleSpies = (["debug", "info", "warn", "error"] as const).map((level) => spyOn(console, level).mockImplementation(() => {}));
  single = spyOn(reportsClient, "reportsApiRequest").mockImplementation(
    (async (_auth: unknown, request: reportsClient.ReportRequest | string) => fixture(request)) as typeof reportsClient.reportsApiRequest,
  );
  many = spyOn(reportsClient, "reportsApiRequests").mockImplementation(
    (async (_auth: unknown, requests: readonly reportsClient.ReportRequest[]) => requests.map((request) => fixture(request))) as typeof reportsClient.reportsApiRequests,
  );
});

afterEach(() => {
  single.mockRestore();
  many.mockRestore();
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("answers match the dashboard", () => {
  it("ranks AI Visibility categories by visits over the whole range and keeps points for those rows only", async () => {
    upstream["/reports/ai-visibility/graphs"] = {
      range,
      points: [
        { date: days[0], categoryValue: "OAI-SearchBot", visits: 230 },
        { date: days[0], categoryValue: "PerplexityBot", visits: 129 },
        { date: days[0], categoryValue: "Meta-ExternalAgent", visits: 4 },
        { date: days[1], categoryValue: "Meta-ExternalAgent", visits: 1164 },
        { date: days[1], categoryValue: "OAI-SearchBot", visits: 741 },
      ],
    };
    const result = await call("get_breakdown", { tenantId, period, report: "ai_visibility", dimension: "agentName", limit: 2 });
    const report = result.structuredContent!.data.report;
    expect(report.rows).toEqual([{ value: "Meta-ExternalAgent", visits: 1168 }, { value: "OAI-SearchBot", visits: 971 }]);
    expect(report.points.map((point: { categoryValue: string }) => point.categoryValue).sort())
      .toEqual(["Meta-ExternalAgent", "Meta-ExternalAgent", "OAI-SearchBot", "OAI-SearchBot"]);
    expect(report.pagination).toMatchObject({ limit: 2, offset: 0, returnedRows: 2, hasMore: true });
  });

  it("answers a weekly AI Visibility page breakdown with many pages a day", async () => {
    const points = days.flatMap((date) => Array.from({ length: 400 }, (_, index) => ({ date, categoryValue: `/page-${index}`, visits: 1000 - index })));
    upstream["/reports/ai-visibility/graphs"] = { range, points };
    const result = await call("get_breakdown", { tenantId, period, report: "ai_visibility", dimension: "pagePath", limit: 5 });
    expect(result.isError).toBeUndefined();
    const report = result.structuredContent!.data.report;
    expect(report.rows).toEqual(["/page-0", "/page-1", "/page-2", "/page-3", "/page-4"].map((value, index) => ({ value, visits: 7 * (1000 - index) })));
    expect(report.points).toHaveLength(35);
  });

  it("returns the overview scorecards without the trend when includeTrend is false", async () => {
    upstream["/reports/overview"] = {
      range, scoreCards: { sessions: 3360, pageViews: 4684 }, timeSeries: days.map((date) => ({ date, sessions: 480 })),
    };
    const result = await call("get_overview", { tenantId, period, report: "overview", includeTrend: false });
    expect(result.isError).toBeUndefined();
    const report = result.structuredContent!.data.report;
    expect(report.scoreCards).toEqual({ sessions: 3360, pageViews: 4684 });
    expect(report.timeSeries).toBeUndefined();
  });

  it("ranks countries and cities by sessions like the dashboard", async () => {
    upstream["/reports/overview"] = {
      range,
      locations: {
        countries: [
          { countryCode: "TR", consentedVisitors: 260, sessions: 1446 },
          { countryCode: "NL", consentedVisitors: 18, sessions: 65 },
          { countryCode: "CN", consentedVisitors: 0, sessions: 359 },
        ],
        cities: [
          { countryCode: "TR", city: "Istanbul", consentedVisitors: 182, sessions: 304 },
          { countryCode: "GB", city: "Merton", consentedVisitors: 3, sessions: 50 },
          { countryCode: "", city: "", consentedVisitors: 53, sessions: 3353 },
        ],
      },
    };
    const countries = await call("get_breakdown", { tenantId, period, report: "overview", dimension: "countries", limit: 2 });
    expect(countries.structuredContent!.data.report.rows.map((row: { countryCode: string }) => row.countryCode)).toEqual(["TR", "CN"]);
    const cities = await call("get_breakdown", { tenantId, period, report: "overview", dimension: "cities", limit: 2 });
    expect(cities.structuredContent!.data.report.rows.map((row: { city: string }) => row.city)).toEqual(["", "Istanbul"]);
  });

  it("reports commerce item CVR as a 0–1 ratio like the other rates and keeps its change in percentage points", async () => {
    upstream["/reports/commerce"] = {
      range, interval: "day",
      scoreCards: {
        orders: { value: 434, previousValue: 414, change: 20, changeRate: 0.0483 },
        item_cvr: { value: 0.5948, previousValue: 0.4948, change: 0.1, changeRate: 0.2022, changeKind: "percentage_points" },
      },
      trend: [],
    };
    const result = await call("get_overview", { tenantId, period, report: "commerce" });
    const scoreCards = result.structuredContent!.data.report.scoreCards;
    expect(scoreCards.item_cvr.value).toBeCloseTo(0.005948, 10);
    expect(scoreCards.item_cvr.previousValue).toBeCloseTo(0.004948, 10);
    expect(scoreCards.item_cvr).toMatchObject({ change: 0.1, changeRate: 0.2022, changeKind: "percentage_points" });
    expect(scoreCards.orders).toEqual({ value: 434, previousValue: 414, change: 20, changeRate: 0.0483 });
  });
});
