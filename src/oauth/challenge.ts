import { config } from "../config";

export function bearerChallenge(error?: { code: string; description: string }): string {
  const origin = new URL(config.oauth.mcpResource).origin;
  const metadataUrl = `${origin}${config.oauth.protectedResourceMetadataPath}`;
  const parts = [`resource_metadata="${metadataUrl}"`];
  if (error) {
    parts.push(`error="${error.code}"`);
    parts.push(`error_description="${error.description}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}
