import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server";
import * as reportsClient from "../../src/reports/client";
import { beaconFixtures, envelopeCases, leakyPath, tenantId } from "./fixtures";

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: { schemaVersion: string; ok: boolean; context: Record<string, any>; data: Record<string, any> };
};

let single: Mock<typeof reportsClient.reportsApiRequest>;
let many: Mock<typeof reportsClient.reportsApiRequests>;
let logged: string[];
const consoleSpies: Array<Mock<typeof console.error>> = [];

function fixture(request: reportsClient.ReportRequest | string) {
  const path = typeof request === "string" ? request : request.path;
  const data = beaconFixtures[path];
  if (!data) throw new Error(`No fixture for ${path}`);
  return { data: structuredClone(data) };
}

async function connect() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "envelope-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  await client.listTools();
  return { server, client };
}

function leaves(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => leaves(entry, `${prefix}/${index}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, entry]) => leaves(entry, `${prefix}/${key}`));
  return [[prefix, value]];
}

function at(value: unknown, path: string): unknown {
  return path.split("/").slice(1).reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], value);
}

const stripped = (value: unknown) => typeof value === "string" && /^(?:\/|https?:\/\/)/.test(value) ? value.replace(/[?#].*$/, "") : value;

beforeEach(() => {
  logged = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    consoleSpies.push(spyOn(console, level).mockImplementation((...parts: unknown[]) => { logged.push(parts.join(" ")); }));
  }
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
  for (const spy of consoleSpies.splice(0)) spy.mockRestore();
});

describe("tool result envelope", () => {
  it("advertises an output schema for every tool", async () => {
    const { server, client } = await connect();
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(6);
      for (const tool of tools) expect(tool.outputSchema?.type).toBe("object");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each(envelopeCases.map((entry) => [entry.tool, entry.args, entry] as const))("%s %j keeps every upstream field", async (tool, args, entry) => {
    const { server, client } = await connect();
    try {
      const result = await client.callTool({ name: tool, arguments: args }) as ToolResult;
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({ schemaVersion: "1.0.0", ok: true });
      expect(JSON.parse(result.content[1]!.text!)).toEqual(result.structuredContent);
      const actual = entry.actual(result.structuredContent!.data);
      for (const [path, value] of leaves(entry.expected(structuredClone(beaconFixtures[entry.upstream]!)))) {
        expect([path, at(actual, path)]).toEqual([path, stripped(value)]);
      }
      expect(JSON.stringify(result)).not.toContain("utm_source=leak");
      if (tool !== "get_context") expect(result.structuredContent!.context).toMatchObject({ tenantId, timezoneOrigin: expect.any(String) });
      expect(logged.join("\n")).not.toContain("kept");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("discloses pagination, missing values and stripped paths without touching values", async () => {
    const { server, client } = await connect();
    try {
      const top = await client.callTool({ name: "get_breakdown", arguments: { tenantId, period: { startDate: "2026-04-01", endDate: "2026-04-07" }, report: "pages", dimension: "top" } }) as ToolResult;
      expect(top.structuredContent!.data.report.rows[0]).toMatchObject({ pagePath: "/catalog", scrollDepth: null, sessions: 9, nested: { note: "kept" } });
      expect(top.structuredContent!.data.report.pagination).toEqual({ limit: 20, offset: 0, total: 1, returnedRows: 1, hasMore: false, truncated: false });
      expect(top.structuredContent!.context).toMatchObject({
        redactedLabels: 1,
        missingValues: [{ path: "/data/report/rows/*/scrollDepth", reason: "upstream_null", count: 1 }],
        completeness: { complete: true, returnedRows: 1, limit: 20, hasMore: false },
        range: { startDate: "2026-04-01", endDate: "2026-04-07", timezone: "Europe/Istanbul" },
        timezoneOrigin: "default",
        source: { mode: "all_sources", sourceId: null },
      });
      const realtime = await client.callTool({ name: "get_overview", arguments: { tenantId, report: "realtime" } }) as ToolResult;
      expect(realtime.structuredContent!.data).toMatchObject({ timeBasis: "rolling_window", range: null });
      expect(realtime.structuredContent!.context.missingValues).toEqual([]);
      expect(realtime.structuredContent!.context).toMatchObject({ timeBasis: "rolling_window", window: { minutes: 5 } });
      const trends = await client.callTool({ name: "get_overview", arguments: { tenantId, report: "page_trends", pagePaths: ["/catalog"] } }) as ToolResult;
      expect(trends.structuredContent!.context.completeness).toEqual({ complete: true, reason: null, returnedRows: 1, limit: 20, hasMore: false });
      const acquisition = await client.callTool({ name: "get_breakdown", arguments: { tenantId, dimension: "acquisition" } }) as ToolResult;
      expect(acquisition.structuredContent!.data.report.trafficDistribution.pagination).toMatchObject({ limit: 20, offset: 0, total: 1, returnedRows: 1, hasMore: false });
      expect(acquisition.structuredContent!.data.appliedFilters.consent).toBe("consented_traffic");
      expect(acquisition.structuredContent!.context.currency).toEqual({ reportingCurrency: "TRY", status: "available", excludedCount: 0 });
      expect(acquisition.structuredContent!.context.filters).toContainEqual({ name: "trafficScope", status: "applied", value: "consented_traffic" });
      expect(acquisition.structuredContent!.context.previousRange).toEqual({ startDate: "2026-03-25", endDate: "2026-03-31", timezone: "Europe/Berlin" });
      expect(leakyPath.startsWith("/catalog")).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers failures with the error envelope in text content and no upstream detail", async () => {
    single.mockRejectedValue(new Error("Reports API request to /reports/overview failed: tenant-not-granted"));
    const { server, client } = await connect();
    try {
      const unsupported = await client.callTool({ name: "get_overview", arguments: { tenantId, report: "pages", interval: "hour" } }) as ToolResult;
      expect(unsupported.isError).toBe(true);
      expect(unsupported.structuredContent).toBeUndefined();
      expect(JSON.parse(unsupported.content[1]!.text!)).toMatchObject({
        schemaVersion: "1.0.0", ok: false, error: { code: "unsupported-filter", retryable: false, retryAfterSeconds: null },
      });
      const failed = await client.callTool({ name: "get_overview", arguments: { tenantId } }) as ToolResult;
      expect(failed.isError).toBe(true);
      expect(JSON.parse(failed.content[1]!.text!).error.code).toBe("upstream-contract-mismatch");
      expect(JSON.stringify(failed)).not.toContain("/reports/overview");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
