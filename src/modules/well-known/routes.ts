import { Elysia } from "elysia";
import { config } from "../../config";

const SUPPORTED_SCOPES = ["reports:read"];

type ProtectedResourceOptions = {
  resource: string;
  issuer: string;
  metadataPath: string;
};

export function createWellKnownRoutes({ resource, issuer, metadataPath }: ProtectedResourceOptions) {
  const protectedResourceMetadata = () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
  });
  const resourcePath = new URL(resource).pathname;
  const routes = new Elysia().get(metadataPath, protectedResourceMetadata);
  if (resourcePath !== "/") routes.get(`${metadataPath}${resourcePath}`, protectedResourceMetadata);
  return routes;
}

export const wellKnownRoutes = createWellKnownRoutes({
  resource: config.oauth.mcpResource,
  issuer: config.oauth.issuer,
  metadataPath: config.oauth.protectedResourceMetadataPath,
});
