import { webcrypto } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "nebula-mcp-test-"));

const pair = (await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
)) as { privateKey: webcrypto.CryptoKey; publicKey: webcrypto.CryptoKey };

const privateJwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
const kid = "nebula-mcp-test-key";

const privatePath = join(directory, "private.jwk.json");
const publicPath = join(directory, "public.jwk.json");
writeFileSync(privatePath, JSON.stringify({ ...privateJwk, kid, alg: "ES256", use: "sig" }));
writeFileSync(publicPath, JSON.stringify({ ...publicJwk, kid, alg: "ES256", use: "sig" }));

delete process.env.SERVICE_PRIVATE_JWK_VAULT_URL;
process.env.SERVICE_PRIVATE_JWK_PATH = privatePath;
process.env.TEST_SERVICE_PUBLIC_JWK_PATH = publicPath;
process.env.SERVICE_CLIENT_ID = "nebula-mcp";
