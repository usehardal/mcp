import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { config } from "../config";
import { commerceFilterFields, commerceGroupFields } from "../tools/report-filters";
import type { ReportsQuery } from "./client";

const selectionLifetimeMs = 15 * 60_000;
const nonceBytes = 12;
const tagBytes = 16;
const audience = Buffer.from("hardal-mcp:commerce-selection:v1");
const reportSettingsVersion = z.string().regex(/^[a-f0-9]{64}$/);

export const itemSelectionId = z.string().min(16).max(72_000).regex(/^[A-Za-z0-9_-]+$/);

const selectedItem = z.strictObject({
  key: z.string().min(1).max(8192),
  groupBy: commerceGroupFields.optional(),
  filterField: commerceFilterFields.optional(),
  filterValue: z.string().optional(),
  settingsVersion: reportSettingsVersion,
});
type SelectedItem = z.infer<typeof selectedItem>;

const selectionPayload = z.strictObject({
  scope: z.string(),
  expiresAt: z.number().int(),
  item: selectedItem,
});

function selectionKey() {
  const value = config.reports.selectionKey;
  if (!value) throw new Error("feature-unavailable: Commerce drill-down requires a configured report selection key.");
  return Buffer.from(value, "base64url");
}

export function requireReportSettingsVersion(meta: Record<string, unknown> | undefined): string {
  const parsed = reportSettingsVersion.safeParse(meta?.reportSettingsVersion);
  if (!parsed.success) {
    throw new Error("feature-unavailable: Beacon did not provide a Commerce report settings version.");
  }
  return parsed.data;
}

function selectionScope(authInfo: AuthInfo | undefined, query: ReportsQuery): string {
  const userId = authInfo?.extra?.userId;
  const tenantIds = authInfo?.extra?.tenantIds;
  if (!authInfo?.token || typeof userId !== "string" || !Array.isArray(tenantIds) || !tenantIds.includes(query.tenantId)) {
    throw new Error("access-denied: The selected tenant is unavailable.");
  }
  return createHash("sha256").update(JSON.stringify([
    userId, authInfo.clientId, authInfo.token, query.tenantId, query.sourceId ?? null,
    query.startDate, query.endDate, query.timezone,
  ])).digest("base64url");
}

export function sealItemSelection(authInfo: AuthInfo | undefined, query: ReportsQuery, item: SelectedItem): string {
  const scope = selectionScope(authInfo, query);
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv("aes-256-gcm", selectionKey(), nonce);
  cipher.setAAD(audience);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ scope, expiresAt: Date.now() + selectionLifetimeMs, item })),
    cipher.final(),
  ]);
  return itemSelectionId.parse(Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url"));
}

export function openItemSelection(authInfo: AuthInfo | undefined, query: ReportsQuery, selectionId: string): SelectedItem {
  const scope = selectionScope(authInfo, query);
  const key = selectionKey();
  try {
    const packed = Buffer.from(selectionId, "base64url");
    const nonce = packed.subarray(0, nonceBytes);
    const tag = packed.subarray(packed.length - tagBytes);
    const encrypted = packed.subarray(nonceBytes, packed.length - tagBytes);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(audience);
    decipher.setAuthTag(tag);
    const payload = selectionPayload.parse(JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")));
    if (payload.scope !== scope || payload.expiresAt <= Date.now()) throw new Error();
    return payload.item;
  } catch {
    throw new Error("selection-expired: Select the Commerce item again with the same authorized report filters.");
  }
}
