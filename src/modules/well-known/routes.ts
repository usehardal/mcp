import { Elysia } from "elysia";
import { config } from "../../config";

const SUPPORTED_SCOPES = ["reports:read"];

const protectedResourceMetadata = () => ({
  resource: config.oauth.mcpResource,
  authorization_servers: [config.oauth.issuer],
  scopes_supported: SUPPORTED_SCOPES,
  bearer_methods_supported: ["header"],
});

const resourcePath = new URL(config.oauth.mcpResource).pathname;

export const wellKnownRoutes = new Elysia()
  .get(config.oauth.protectedResourceMetadataPath, protectedResourceMetadata)
  .get(`${config.oauth.protectedResourceMetadataPath}${resourcePath}`, protectedResourceMetadata);
