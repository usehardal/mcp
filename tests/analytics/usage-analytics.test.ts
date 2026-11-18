import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PostHog } from "posthog-node";
import { createUsageAnalytics, type UsageAnalytics } from "../../src/analytics/usage-analytics";
import { createMcpServer } from "../../src/mcp/server";
import { resetDiscoveryCache } from "../../src/oauth/discovery";
import { resetExchangeCache } from "../../src/oauth/exchange-cache";
import { beaconFixtureFetch, reportScope, resetFixtureState, tenantId } from "../mcp/v1-fixtures";

type SentEvent = { event: string; distinct_id: string; properties: Record<string, unknown> };

const otherTenant = "44444444-4444-4444-8444-444444444444";
const posthogOptions = { enabled: true, projectToken: "phc_test", host: "https://eu.i.posthog.com" };

function authInfo(extra: Record<string, unknown> = {}): AuthInfo {
  return {
    token: "mcp-token",
    clientId: "client-1",
    scopes: ["reports:read"],
    extra: {
      userId: "user-1",
      tenantIds: [tenantId],
      tenantOrganizations: { [tenantId]: "org-1" },
      isInternal: true,
      clientName: "Claude",
      ...extra,
    },
  };
}

function recordingAnalytics(fail = false) {
  const sent: SentEvent[] = [];
  const analytics = createUsageAnalytics(posthogOptions, (token, host) =>
    new PostHog(token, {
      host,
      flushAt: 1,
      disableCompression: true,
      enableExceptionAutocapture: false,
      fetch: async (_url: string, init: { body?: string }) => {
        if (fail) throw new Error("posthog down");
        sent.push(...(JSON.parse(init.body!) as { batch: SentEvent[] }).batch);
        return Response.json({ results: {} });
      },
    } as ConstructorParameters<typeof PostHog>[1]),
  );
  return { analytics, sent };
}

async function connect(analytics: UsageAnalytics | undefined, auth: AuthInfo = authInfo()) {
  const server = analytics ? createMcpServer(analytics) : createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) => send(message, { ...options, authInfo: auth });
  const client = new Client({ name: "claude-ai", version: "0.1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

async function run(analytics: UsageAnalytics, auth?: AuthInfo) {
  const { server, client } = await connect(analytics, auth);
  await client.listTools();
  const ok = await client.callTool({ name: "get_overview", arguments: reportScope });
  const failed = await client.callTool({
    name: "get_overview",
    arguments: { ...reportScope, period: { startDate: "2026-04-07", endDate: "2026-04-01" } },
  });
  await client.close();
  await server.close();
  await analytics.shutdown();
  return { ok, failed };
}

beforeEach(() => {
  resetFixtureState();
  spyOn(globalThis, "fetch").mockImplementation(beaconFixtureFetch());
});

afterEach(() => {
  resetDiscoveryCache();
  resetExchangeCache();
  mock.restore();
});

describe("usage analytics", () => {
  it("sends initialize, tools list and tool calls with the user, tenant, organization and AI client", async () => {
    const { analytics, sent } = recordingAnalytics();
    const { failed } = await run(analytics);

    expect(sent.map((event) => event.event).sort()).toEqual(
      ["$mcp_initialize", "$mcp_tool_call", "$mcp_tool_call", "$mcp_tools_list"],
    );
    for (const event of sent) {
      expect(event.distinct_id).toBe("user-1");
      expect(event.properties).toMatchObject({ app: "hardal-mcp", ai_client: "claude", is_internal: true });
    }
    const calls = sent.filter((event) => event.event === "$mcp_tool_call");
    for (const call of calls) {
      expect(call.properties.$mcp_tool_name).toBe("get_overview");
      expect(call.properties.$groups).toEqual({ tenant: tenantId, organization: "org-1" });
    }
    const failedCode = String((failed.content as Array<{ text: string }>)[0]!.text).split(":")[0];
    expect(calls.map((call) => [call.properties.$mcp_is_error ?? false, call.properties.$mcp_error_type ?? null]).sort())
      .toEqual([[false, null], [true, failedCode]].sort());
  });

  it("never sends arguments, report data, error text, intent, model or conversation", async () => {
    const { analytics, sent } = recordingAnalytics();
    await run(analytics);

    // Everything that may be sent; arguments, responses, error text, intent, model and conversation are not.
    const allowed = new Set([
      "$geoip_disable", "$groups", "$is_server", "$lib", "$lib_version", "$mcp_client_name", "$mcp_client_version",
      "$mcp_duration_ms", "$mcp_error_type", "$mcp_input_keys", "$mcp_interface", "$mcp_is_error",
      "$mcp_listed_tool_names", "$mcp_protocol_version", "$mcp_resource_name", "$mcp_server_name",
      "$mcp_server_version", "$mcp_source", "$mcp_tool_description", "$mcp_tool_name", "ai_client", "app", "is_internal",
    ]);
    for (const event of sent) {
      expect(Object.keys(event.properties).filter((key) => !allowed.has(key))).toEqual([]);
    }
    const payload = JSON.stringify(sent);
    for (const value of ["2026-04-01", "2026-04-07", "Europe/Berlin", reportScope.sourceId, "Chrome", "mcp-token", "delegated-fixture"]) {
      expect(payload).not.toContain(value);
    }
    expect(sent.find((event) => event.event === "$mcp_tool_call")?.properties.$mcp_input_keys).toBeDefined();
  });

  it("leaves out unapproved tenants, our team flag for customers and unknown app names", async () => {
    const { analytics, sent } = recordingAnalytics();
    const { server, client } = await connect(analytics, authInfo({ isInternal: false, clientName: "MCP Inspector" }));
    await client.callTool({ name: "get_overview", arguments: { ...reportScope, tenantId: otherTenant } });
    await client.close();
    await server.close();
    await analytics.shutdown();

    const call = sent.find((event) => event.event === "$mcp_tool_call")!;
    expect(call.properties.$groups).toBeUndefined();
    expect(call.properties.ai_client).toBe("other");
    expect(call.properties).not.toHaveProperty("is_internal");
  });

  it("keeps the advertised tool input schemas unchanged", async () => {
    const schemas = async (analytics?: UsageAnalytics) => {
      const { server, client } = await connect(analytics);
      const { tools } = await client.listTools();
      await client.close();
      await server.close();
      return tools.map((tool) => [tool.name, tool.inputSchema]);
    };
    const { analytics } = recordingAnalytics();

    expect(await schemas(analytics)).toEqual(await schemas());
    await analytics.shutdown();
  });

  it("does not fail a tool call when PostHog is down", async () => {
    const { analytics } = recordingAnalytics(true);
    const { ok } = await run(analytics);

    expect(ok.isError).toBeUndefined();
  });

  it("creates no PostHog client when analytics is off or has no token", () => {
    let created = 0;
    const create = (token: string, host: string) => {
      created++;
      return new PostHog(token, { host });
    };
    createUsageAnalytics({ ...posthogOptions, enabled: false }, create);
    createUsageAnalytics({ ...posthogOptions, projectToken: undefined }, create);

    expect(created).toBe(0);
  });
});
