import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(1922),

  OAUTH_ISSUER: z.string().url().default("http://localhost:1919"),
  BEACON_API_URL: z.string().url().default("http://localhost:1919"),
  MCP_RESOURCE: z.string().url().default("http://localhost:1922"),
  REPORTS_API_RESOURCE: z.string().url().default("http://localhost:1919/v1"),
  MCP_REPORTS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(2).default(300),
  MCP_REPORT_SELECTION_KEY: z.union([z.literal(""), z.string().regex(/^[A-Za-z0-9_-]{43}$/)]).optional(),

  SERVICE_CLIENT_ID: z.string().min(1).default("hardal-mcp"),
  SERVICE_PRIVATE_JWK_PATH: z.string().optional(),
  SERVICE_PRIVATE_JWK_VAULT_URL: z.string().url().optional(),
});

export type AppConfig = ReturnType<typeof loadEnv>;

export function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${details}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === "production" && !env.SERVICE_PRIVATE_JWK_VAULT_URL) {
    throw new Error("SERVICE_PRIVATE_JWK_VAULT_URL is required in production");
  }

  return {
    nodeEnv: env.NODE_ENV,
    server: {
      port: env.PORT,
    },
    reports: {
      rateLimitPerMinute: env.MCP_REPORTS_RATE_LIMIT_PER_MINUTE,
      selectionKey: env.MCP_REPORT_SELECTION_KEY || undefined,
    },
    oauth: {
      issuer: env.OAUTH_ISSUER,
      beaconApiUrl: env.BEACON_API_URL,
      mcpResource: env.MCP_RESOURCE,
      reportsApiResource: env.REPORTS_API_RESOURCE,
      protectedResourceMetadataPath: "/.well-known/oauth-protected-resource",
      legacyMcpPath: "/mcp",
    },
    serviceIdentity: {
      clientId: env.SERVICE_CLIENT_ID,
      privateJwkPath: env.SERVICE_PRIVATE_JWK_PATH,
      privateJwkVaultUrl: env.SERVICE_PRIVATE_JWK_VAULT_URL,
    },
  };
}
