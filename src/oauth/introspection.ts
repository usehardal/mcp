import { CLIENT_ASSERTION_TYPE_JWT_BEARER } from "./constants";
import { discoverAuthorizationServer } from "./discovery";
import { createServiceAssertion } from "./service-assertion";

export type IntrospectionResult =
  | { active: false }
  | {
      active: true;
      userId: string;
      clientId: string | null;
      scopes: string[];
      tenantIds: string[];
      resource: string | null;
      expiresAt: number | null;
    };

type IntrospectionResponse = {
  active: boolean;
  scope?: string;
  sub?: string;
  client_id?: string | null;
  aud?: string | null;
  exp?: number | null;
  tenant_ids?: string[];
};

export async function introspectToken(token: string): Promise<IntrospectionResult> {
  const metadata = await discoverAuthorizationServer();
  const assertion = await createServiceAssertion(metadata.introspection_endpoint);

  const response = await fetch(metadata.introspection_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
      client_assertion: assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`introspection failed (HTTP ${response.status})`);
  }

  const body = (await response.json()) as IntrospectionResponse;
  if (!body.active || !body.sub) {
    return { active: false };
  }

  return {
    active: true,
    userId: body.sub,
    clientId: body.client_id ?? null,
    scopes: body.scope ? body.scope.split(" ").filter((scope) => scope.length > 0) : [],
    tenantIds: body.tenant_ids ?? [],
    resource: body.aud ?? null,
    expiresAt: body.exp ?? null,
  };
}
