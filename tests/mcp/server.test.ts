import { describe, it, expect } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../src/mcp/server";

const EXPECTED_TOOLS = [
  "get_context",
  "get_overview",
  "get_breakdown",
  "compare_periods",
  "get_events",
  "get_funnels",
];

async function connectClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "nebula-mcp-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

describe("createMcpServer", () => {
  it("registers all six tools with object input schemas", async () => {
    const { server, client } = await connectClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...EXPECTED_TOOLS].sort());
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe("object");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("exposes trafficScope only on get_breakdown, not get_overview", async () => {
    const { server, client } = await connectClient();
    try {
      const { tools } = await client.listTools();
      const breakdown = tools.find((tool) => tool.name === "get_breakdown");
      const overview = tools.find((tool) => tool.name === "get_overview");
      expect(Object.keys(breakdown?.inputSchema.properties ?? {})).toContain("dimension");
      expect(Object.keys(breakdown?.inputSchema.properties ?? {})).toContain("trafficScope");
      expect(Object.keys(overview?.inputSchema.properties ?? {})).not.toContain("trafficScope");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
