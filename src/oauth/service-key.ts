import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { config } from "../config";

export type ServiceSigningKey = {
  kid: string;
  key: webcrypto.CryptoKey;
};

let loaded: ServiceSigningKey | undefined;

async function readPrivateJwk(): Promise<Record<string, unknown>> {
  const { privateJwkPath, privateJwkVaultUrl } = config.serviceIdentity;

  if (privateJwkVaultUrl) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const { SecretClient } = await import("@azure/keyvault-secrets");
    const url = new URL(privateJwkVaultUrl);
    const vaultUrl = `${url.protocol}//${url.host}`;
    const segments = url.pathname.split("/").filter(Boolean);
    const secretName = segments[segments.length - 1];
    if (!secretName) throw new Error("SERVICE_PRIVATE_JWK_VAULT_URL must name a secret");
    const client = new SecretClient(vaultUrl, new DefaultAzureCredential());
    const secret = await client.getSecret(secretName);
    if (!secret.value) throw new Error(`Key Vault secret ${secretName} is empty`);
    return JSON.parse(secret.value) as Record<string, unknown>;
  }

  if (privateJwkPath) {
    return JSON.parse(await readFile(privateJwkPath, "utf8")) as Record<string, unknown>;
  }

  throw new Error("set SERVICE_PRIVATE_JWK_PATH (dev) or SERVICE_PRIVATE_JWK_VAULT_URL (prod)");
}

export async function getServiceSigningKey(): Promise<ServiceSigningKey> {
  if (loaded) return loaded;

  const jwk = await readPrivateJwk();
  if (typeof jwk.kid !== "string" || !jwk.kid) {
    throw new Error("the service private JWK must contain a string kid");
  }

  const key = await webcrypto.subtle.importKey(
    "jwk",
    jwk as webcrypto.JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  loaded = { kid: jwk.kid, key };
  return loaded;
}
