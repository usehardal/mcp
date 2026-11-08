import { mkdir, writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { dirname, resolve } from "node:path";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function defaultKid(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `nebula-mcp-${today}`;
}

async function main() {
  const kid = arg("--kid") ?? defaultKid();
  const outDir = resolve(arg("--out") ?? "keys");

  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await webcrypto.subtle.exportKey("jwk", keyPair.privateKey);

  const publicKey = { ...publicJwk, kid, use: "sig", alg: "ES256" };
  const privateKey = { ...privateJwk, kid, use: "sig", alg: "ES256" };

  const publicPath = resolve(outDir, "public.jwk.json");
  const privatePath = resolve(outDir, "private.jwk.json");
  await mkdir(dirname(publicPath), { recursive: true });
  await writeFile(publicPath, `${JSON.stringify(publicKey, null, 2)}\n`);
  await writeFile(privatePath, `${JSON.stringify(privateKey, null, 2)}\n`, { mode: 0o600 });

  console.info(`Generated ES256 service identity (kid: ${kid})`);
  console.info(`  public : ${publicPath}`);
  console.info(`  private: ${privatePath}`);
  console.info("");
  console.info("Register the public key in Beacon:");
  console.info(
    "  DATABASE_URL=<beacon db> bun run scripts/register-oauth-service-identity.ts \\",
  );
  console.info(
    `    --client-id nebula-mcp --jwk ${publicPath} --operations introspect,token_exchange`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
