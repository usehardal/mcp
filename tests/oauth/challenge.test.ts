import { describe, it, expect } from "bun:test";
import { bearerChallenge } from "../../src/oauth/challenge";

describe("bearerChallenge", () => {
  it("points at the protected-resource metadata on the MCP origin", () => {
    const header = bearerChallenge();
    expect(header.startsWith("Bearer ")).toBe(true);
    expect(header).toContain(
      'resource_metadata="http://localhost:1922/.well-known/oauth-protected-resource"',
    );
    expect(header).not.toContain("error=");
  });

  it("carries the error code and description when given", () => {
    const header = bearerChallenge({ code: "unauthorized", description: "token required" });
    expect(header).toContain('error="unauthorized"');
    expect(header).toContain('error_description="token required"');
  });
});
