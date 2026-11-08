import { webcrypto } from "node:crypto";
import { config } from "../config";
import { ASSERTION_ALGORITHM, ASSERTION_TTL_SECONDS } from "./constants";
import { getServiceSigningKey } from "./service-key";

function base64url(input: string | Uint8Array): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buffer.toString("base64url");
}

export async function createServiceAssertion(audience: string): Promise<string> {
  const { kid, key } = await getServiceSigningKey();
  const clientId = config.serviceIdentity.clientId;
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: ASSERTION_ALGORITHM, kid, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: clientId,
      sub: clientId,
      aud: audience,
      iat: now,
      exp: now + ASSERTION_TTL_SECONDS,
      jti: webcrypto.randomUUID(),
    }),
  );

  const signingInput = `${header}.${payload}`;
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    Buffer.from(signingInput, "utf8"),
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
