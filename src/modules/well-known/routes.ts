import { Elysia } from "elysia";
import { config } from "../../config";

const SUPPORTED_SCOPES = ["reports:read"];

export const wellKnownRoutes = new Elysia().get(
  config.oauth.protectedResourceMetadataPath,
  () => ({
    resource: config.oauth.mcpResource,
    authorization_servers: [config.oauth.issuer],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
  }),
);
