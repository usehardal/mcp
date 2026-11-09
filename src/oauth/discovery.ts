import { config } from "../config";

export type AuthorizationServerMetadata = {
  issuer: string;
  token_endpoint: string;
  introspection_endpoint: string;
  authorization_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  scopes_supported: string[];
};

const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";

let cached: AuthorizationServerMetadata | undefined;

export async function discoverAuthorizationServer(): Promise<AuthorizationServerMetadata> {
  if (cached) return cached;

  const url = `${config.oauth.beaconApiUrl}${DISCOVERY_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`authorization server discovery failed (HTTP ${response.status})`);
  }

  const metadata = (await response.json()) as Partial<AuthorizationServerMetadata>;
  if (!metadata.token_endpoint || !metadata.introspection_endpoint || !metadata.issuer) {
    throw new Error("authorization server metadata is missing required endpoints");
  }

  cached = metadata as AuthorizationServerMetadata;
  return cached;
}

export function resetDiscoveryCache() {
  cached = undefined;
}
