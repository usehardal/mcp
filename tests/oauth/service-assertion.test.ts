import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { createServiceAssertion } from "../../src/oauth/service-assertion";

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

describe("createServiceAssertion", () => {
  it("builds an ES256 JWT for the service identity with a bounded lifetime", async () => {
    const audience = "http://localhost:1919/oauth/introspect";
    const token = await createServiceAssertion(audience);
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    expect(signatureSegment.length).toBeGreaterThan(0);

    const header = decodeSegment(headerSegment);
    const payload = decodeSegment(payloadSegment);
    expect(header.alg).toBe("ES256");
    expect(header.typ).toBe("JWT");
    expect(typeof header.kid).toBe("string");
    expect(payload.iss).toBe("hardal-mcp");
    expect(payload.sub).toBe("hardal-mcp");
    expect(payload.aud).toBe(audience);
    expect(typeof payload.jti).toBe("string");
    expect((payload.exp as number) - (payload.iat as number)).toBe(60);
  });

  it("uses a fresh jti on every call", async () => {
    const first = await createServiceAssertion("audience");
    const second = await createServiceAssertion("audience");
    expect(decodeSegment(first.split(".")[1]).jti).not.toBe(decodeSegment(second.split(".")[1]).jti);
  });

  it("produces a signature the matching public key verifies", async () => {
    const token = await createServiceAssertion("audience");
    const [headerSegment, payloadSegment, signatureSegment] = token.split(".");
    const publicJwk = JSON.parse(
      await readFile(process.env.TEST_SERVICE_PUBLIC_JWK_PATH as string, "utf8"),
    );
    const key = await webcrypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      Buffer.from(signatureSegment, "base64url"),
      Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8"),
    );
    expect(verified).toBe(true);
  });
});
