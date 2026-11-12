import { Elysia } from "elysia";
import { config } from "../../config";

const SUPPORTED_SCOPES = ["reports:read"];

const protectedResourceMetadata = () => ({
  resource: config.oauth.mcpResource,
  authorization_servers: [config.oauth.issuer],
  scopes_supported: SUPPORTED_SCOPES,
  bearer_methods_supported: ["header"],
});

const metadataPath = config.oauth.protectedResourceMetadataPath;
const resourcePath = new URL(config.oauth.mcpResource).pathname;
const metadataPaths = new Set([
  metadataPath,
  `${metadataPath}${config.oauth.legacyMcpPath}`,
  ...(resourcePath === "/" ? [] : [`${metadataPath}${resourcePath}`]),
]);

function registerMetadataRoutes(app: Elysia) {
  for (const path of metadataPaths) app.get(path, protectedResourceMetadata);
  return app;
}

export const wellKnownRoutes = registerMetadataRoutes(new Elysia());
