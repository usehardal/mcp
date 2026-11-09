import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerComparePeriodsTool } from "../tools/compare-periods";
import { registerGetBreakdownTool } from "../tools/get-breakdown";
import { registerGetContextTool } from "../tools/get-context";
import { registerGetEventsTool } from "../tools/get-events";
import { registerGetFunnelsTool } from "../tools/get-funnels";
import { registerGetOverviewTool } from "../tools/get-overview";

export function createMcpServer() {
  const server = new McpServer({ name: "Hardal MCP", version: "1.0.0" });
  registerGetContextTool(server);
  registerGetOverviewTool(server);
  registerGetBreakdownTool(server);
  registerComparePeriodsTool(server);
  registerGetEventsTool(server);
  registerGetFunnelsTool(server);
  return server;
}
