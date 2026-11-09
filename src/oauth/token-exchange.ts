import { config } from "../config";
import {
  CLIENT_ASSERTION_TYPE_JWT_BEARER,
  GRANT_TYPE_TOKEN_EXCHANGE,
  REPORTS_READ_SCOPE,
  TOKEN_TYPE_ACCESS_TOKEN,
  TOKEN_TYPE_JWT,
} from "./constants";
import { discoverAuthorizationServer } from "./discovery";
import { createServiceAssertion } from "./service-assertion";

export type DelegatedToken = {
  accessToken: string;
  expiresInSeconds: number;
  scopes: string[];
};

type ExchangeResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeForReportsApiToken(subjectToken: string): Promise<DelegatedToken> {
  const metadata = await discoverAuthorizationServer();
  const assertion = await createServiceAssertion(metadata.token_endpoint);

  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
      subject_token: subjectToken,
      subject_token_type: TOKEN_TYPE_ACCESS_TOKEN,
      actor_token: assertion,
      actor_token_type: TOKEN_TYPE_JWT,
      client_assertion: assertion,
      client_assertion_type: CLIENT_ASSERTION_TYPE_JWT_BEARER,
      resource: config.oauth.reportsApiResource,
      scope: REPORTS_READ_SCOPE,
    }),
  });

  const body = (await response.json()) as ExchangeResponse;
  if (!response.ok || !body.access_token) {
    const reason = body.error_description ?? body.error ?? `HTTP ${response.status}`;
    throw new Error(`token exchange failed: ${reason}`);
  }

  return {
    accessToken: body.access_token,
    expiresInSeconds: body.expires_in ?? 0,
    scopes: body.scope ? body.scope.split(" ").filter((scope) => scope.length > 0) : [],
  };
}
