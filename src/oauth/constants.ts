export const GRANT_TYPE_TOKEN_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange";
export const TOKEN_TYPE_ACCESS_TOKEN = "urn:ietf:params:oauth:token-type:access_token";
export const TOKEN_TYPE_JWT = "urn:ietf:params:oauth:token-type:jwt";
export const CLIENT_ASSERTION_TYPE_JWT_BEARER =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

export const ASSERTION_ALGORITHM = "ES256";
export const ASSERTION_TTL_SECONDS = 60;

export const REPORTS_READ_SCOPE = "reports:read";

export enum ServiceOperation {
  Introspect = "introspect",
  TokenExchange = "token_exchange",
}
