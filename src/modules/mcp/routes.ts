import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Elysia } from "elysia";
import { config } from "../../config";
import { logger } from "../../common/logger";
import { bearerChallenge } from "../../oauth/challenge";
import { introspectToken } from "../../oauth/introspection";
import { createMcpServer } from "../../mcp/server";

const BEARER_SCHEME = /^Bearer\s+(\S+)$/i;

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header ? (BEARER_SCHEME.exec(header)?.[1] ?? undefined) : undefined;
}

function unauthorized(description: string): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized", error_description: description }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": bearerChallenge({ code: "unauthorized", description }),
      },
    },
  );
}

async function handleMcpRequest({ request, body }: { request: Request; body: unknown }): Promise<Response> {
  const token = bearerToken(request);
  if (!token) {
    return unauthorized("Authentication is required to use the Hardal MCP server.");
  }

  const introspection = await introspectToken(token);
  if (!introspection.active) {
    return unauthorized("The token is invalid, expired or revoked.");
  }

  if (introspection.resource !== config.oauth.mcpResource) {
    return unauthorized("The token was not issued for the MCP server.");
  }

  const authInfo: AuthInfo = {
    token,
    clientId: introspection.clientId ?? "",
    scopes: introspection.scopes,
    expiresAt: introspection.expiresAt ?? undefined,
    extra: { userId: introspection.userId, tenantIds: introspection.tenantIds },
  };

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo, parsedBody: body });
  } catch (error) {
    logger.error("MCP request failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const mcpRoutes = new Elysia()
  .all("/", handleMcpRequest)
  .all(config.oauth.legacyMcpPath, handleMcpRequest);
