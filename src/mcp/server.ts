import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolFailure, errorResult } from "../tools/output/errors";
import { registerComparePeriodsTool } from "../tools/compare-periods";
import { registerGetBreakdownTool } from "../tools/get-breakdown";
import { registerGetContextTool } from "../tools/get-context";
import { registerGetEventsTool } from "../tools/get-events";
import { registerGetFunnelsTool } from "../tools/get-funnels";
import { registerGetOverviewTool } from "../tools/get-overview";

const inputValidationMessage = /^(?:MCP error -?\d+: )?(?:Input validation error: )?Invalid arguments for tool /;
const maxErrorMessageLength = 512;

type ToolErrorFactory = { createToolError: (message: string) => CallToolResult };

function envelopeToolErrors(server: McpServer) {
  const sdk = server as unknown as ToolErrorFactory;
  const fallback = sdk.createToolError.bind(server);
  sdk.createToolError = (message) => inputValidationMessage.test(message)
    ? errorResult(new ToolFailure("invalid-arguments", message.replace(/^(?:MCP error -?\d+: )?(?:Input validation error: )?/, "").slice(0, maxErrorMessageLength)))
    : fallback(message);
}

export function createMcpServer() {
  const server = new McpServer({ name: "Hardal MCP", version: "1.0.0" });
  envelopeToolErrors(server);
  registerGetContextTool(server);
  registerGetOverviewTool(server);
  registerGetBreakdownTool(server);
  registerComparePeriodsTool(server);
  registerGetEventsTool(server);
  registerGetFunnelsTool(server);
  return server;
}
