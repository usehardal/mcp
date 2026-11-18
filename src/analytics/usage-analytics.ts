import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { instrument, type MCPAnalyticsOptions } from "@posthog/mcp";
import { PostHog } from "posthog-node";
import { logger } from "../common/logger";
import { config } from "../config";
import { toolErrorCodes } from "../tools/output/errors";
import { aiClientFromName } from "./ai-client";

export type UsageAnalytics = {
  instrument(server: McpServer): void;
  shutdown(): Promise<void>;
};

type UsageAnalyticsOptions = {
  enabled: boolean;
  projectToken: string | undefined;
  host: string;
};

type Caller = {
  userId: string;
  tenantIds: string[];
  tenantOrganizations: Record<string, string>;
  isInternal: boolean;
  clientName: string | null;
};

const codedErrorMessage = /^([a-z]+(?:-[a-z]+)*): /;

const createPostHogClient = (projectToken: string, host: string) =>
  new PostHog(projectToken, { host, enableExceptionAutocapture: false });

/** The signed-in caller, from the auth info the MCP route builds from Beacon's introspection. */
function caller(extra: unknown): Caller | undefined {
  const auth = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo?.extra;
  if (typeof auth?.userId !== "string") return undefined;
  return {
    userId: auth.userId,
    tenantIds: Array.isArray(auth.tenantIds) ? auth.tenantIds : [],
    tenantOrganizations: (auth.tenantOrganizations ?? {}) as Record<string, string>,
    isInternal: auth.isInternal === true,
    clientName: typeof auth.clientName === "string" ? auth.clientName : null,
  };
}

/** Our tool error code from a failed call's message, never the message itself. */
function errorType(message: string) {
  const code = codedErrorMessage.exec(message)?.[1];
  return code && (toolErrorCodes as readonly string[]).includes(code) ? code : "unknown";
}

const instrumentOptions: MCPAnalyticsOptions = {
  context: false,
  captureModel: false,
  enableConversationId: false,
  enableExceptionAutocapture: false,
  identify: async (request, extra) => {
    const who = caller(extra);
    if (!who) return null;
    const tenantId = request.params?.arguments?.tenantId;
    if (typeof tenantId !== "string" || !who.tenantIds.includes(tenantId)) return { distinctId: who.userId };
    const organizationId = who.tenantOrganizations[tenantId];
    return { distinctId: who.userId, groups: { tenant: tenantId, ...(organizationId ? { organization: organizationId } : {}) } };
  },
  eventProperties: (_request, extra) => {
    const who = caller(extra);
    return { app: "hardal-mcp", ai_client: aiClientFromName(who?.clientName ?? null), ...(who?.isInternal ? { is_internal: true } : {}) };
  },
  beforeSend: (event) => {
    const properties = event.properties;
    delete properties.$mcp_parameters;
    delete properties.$mcp_response;
    if (typeof properties.$mcp_error_message === "string") {
      properties.$mcp_error_type = errorType(properties.$mcp_error_message);
      delete properties.$mcp_error_message;
    }
    return event;
  },
};

/**
 * Tool-call usage analytics in PostHog: tool, duration, error code, user,
 * tenant and AI client. Arguments, report data and error text are never sent.
 * Off unless enabled with a project token; analytics never fails a request.
 */
export function createUsageAnalytics(
  options: UsageAnalyticsOptions,
  createClient = createPostHogClient,
): UsageAnalytics {
  if (!options.enabled || !options.projectToken) {
    return { instrument: () => {}, shutdown: async () => {} };
  }
  const posthog = createClient(options.projectToken, options.host);
  return {
    instrument(server) {
      try {
        instrument(server, posthog, instrumentOptions);
      } catch (error) {
        logger.warn("Usage analytics unavailable", { message: error instanceof Error ? error.message : String(error) });
      }
    },
    async shutdown() {
      try {
        await posthog.shutdown();
      } catch {
        // Analytics is best effort.
      }
    },
  };
}

export const usageAnalytics = createUsageAnalytics(config.analytics);
