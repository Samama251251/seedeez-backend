import { env } from "../config/env.js";

// Cloudflare for SaaS (Custom Hostnames) client.
// Customer CNAMEs blog.theirs.com -> our fallback origin (cname.seedeez.com);
// Cloudflare issues + renews the per-hostname cert via DCV. We create the
// Custom Hostname, then poll its status until the cert is active.
// Docs: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/

const API_BASE = "https://api.cloudflare.com/client/v4";

export type CfCustomHostnameStatus =
  | "pending"
  | "pending_validation"
  | "pending_deletion"
  | "active"
  | "active_redeploying"
  | "moved"
  | "deleted"
  | "blocked";

export type CfSslStatus =
  | "initializing"
  | "pending_validation"
  | "pending_issuance"
  | "pending_deployment"
  | "active"
  | "expired"
  | "deleted"
  | "validation_timed_out";

// DNS-record instruction Cloudflare wants the customer to add to prove control
// of the hostname (used when DCV needs a TXT, or to display the CNAME).
export interface CfValidationRecord {
  txt_name?: string;
  txt_value?: string;
  http_url?: string;
  http_body?: string;
  cname?: string;
  cname_target?: string;
}

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status: CfCustomHostnameStatus;
  ssl: {
    status: CfSslStatus;
    validation_records?: CfValidationRecord[];
    validation_errors?: { message: string }[];
  };
  verification_errors?: string[];
}

interface CfEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  result: T;
}

function requireCfConfig(): { token: string; zoneId: string } {
  const token = env.cloudflareApiToken;
  const zoneId = env.cloudflareZoneId;
  if (!token || !zoneId) {
    throw new Error(
      "Cloudflare for SaaS not configured: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID",
    );
  }
  return { token, zoneId };
}

async function cfFetch<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...rest.headers,
    },
  });

  const body = (await res.json()) as CfEnvelope<T>;
  if (!res.ok || !body.success) {
    const detail = body.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare API error (${res.status}): ${detail}`);
  }
  return body.result;
}

// Create a Custom Hostname for blog.theirs.com. Uses HTTP DCV by default so the
// proxied CNAME is enough to validate; falls back to TXT if HTTP can't be used.
export async function createCustomHostname(
  hostname: string,
): Promise<CfCustomHostname> {
  const { token, zoneId } = requireCfConfig();
  return cfFetch<CfCustomHostname>(`/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    token,
    body: JSON.stringify({
      hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: { min_tls_version: "1.2" },
      },
    }),
  });
}

export async function getCustomHostname(id: string): Promise<CfCustomHostname> {
  const { token, zoneId } = requireCfConfig();
  return cfFetch<CfCustomHostname>(`/zones/${zoneId}/custom_hostnames/${id}`, {
    method: "GET",
    token,
  });
}

export async function deleteCustomHostname(id: string): Promise<void> {
  const { token, zoneId } = requireCfConfig();
  await cfFetch<{ id: string }>(`/zones/${zoneId}/custom_hostnames/${id}`, {
    method: "DELETE",
    token,
  });
}

// A hostname is live when both the hostname is active and the cert is issued.
export function isCustomHostnameLive(ch: CfCustomHostname): boolean {
  return ch.status === "active" && ch.ssl.status === "active";
}

// Surface a human-readable error for the support / failed path, if any.
export function customHostnameError(ch: CfCustomHostname): string | null {
  const sslErr = ch.ssl.validation_errors?.map((e) => e.message).join("; ");
  const verErr = ch.verification_errors?.join("; ");
  return sslErr || verErr || null;
}
