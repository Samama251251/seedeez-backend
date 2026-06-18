import { Router } from "express";
import { resolveCname } from "node:dns/promises";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { domains } from "../db/schema/index.js";
import type { DnsTier, DomainStatus } from "../db/schema/index.js";
import { verifyToken } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import {
  createCustomHostname,
  getCustomHostname,
  customHostnameError,
  isCustomHostnameLive,
} from "../lib/cloudflare.js";
import {
  discoverDomainConnect,
  buildApplyUrl,
} from "../lib/domain-connect.js";

export const domainsRouter = Router();

// Strip scheme/path/www and lowercase -> bare apex, e.g. "theirs.com".
function toBareDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");
}

// Subdomain labels: DNS-safe single label, 1-63 chars, no leading/trailing hyphen.
function isValidLabel(label: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
}

function isValidDomain(domain: string): boolean {
  return /^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(domain);
}

// Pull the latest Cloudflare status into our row; flips to active/failed.
async function refreshStatus(row: typeof domains.$inferSelect) {
  if (!row.cfCustomHostnameId) return row;
  try {
    const ch = await getCustomHostname(row.cfCustomHostnameId);
    const status: DomainStatus = isCustomHostnameLive(ch)
      ? "active"
      : row.status === "failed"
        ? "failed"
        : "pending";
    const lastError = customHostnameError(ch);
    const [updated] = await db
      .update(domains)
      .set({ status, lastError, updatedAt: new Date() })
      .where(eq(domains.id, row.id))
      .returning();
    return updated ?? row;
  } catch (err) {
    logger.error({ err, domainId: row.id }, "Failed to refresh custom hostname");
    return row;
  }
}

// Manual-tier CNAME the customer pastes into their DNS host.
function manualInstructions(fullHostname: string) {
  return {
    type: "CNAME" as const,
    name: fullHostname,
    target: env.cloudflareFallbackOrigin,
    // Only matters on Cloudflare's manual path; harmless elsewhere.
    note: "If your DNS is on Cloudflare, set Proxy status to 'DNS only' (grey cloud).",
  };
}

// GET /api/domains — current user's domain + live-refreshed status.
domainsRouter.get("/", verifyToken, async (req, res) => {
  const existing = await db.query.domains.findFirst({
    where: eq(domains.userId, req.user!.userId),
  });
  if (!existing) {
    res.json({ domain: null });
    return;
  }
  const row = await refreshStatus(existing);
  res.json({ domain: row, cname: manualInstructions(row.fullHostname) });
});

// GET /api/domains/discover?domain=theirs.com&subdomain=blog
// Probe the DNS host without committing: tells the UI one-click vs manual.
domainsRouter.get("/discover", verifyToken, async (req, res) => {
  const rawDomain = String(req.query.domain ?? "");
  const subdomain = String(req.query.subdomain ?? "blog").toLowerCase();
  const domain = toBareDomain(rawDomain);

  if (!isValidDomain(domain)) {
    res.status(400).json({ error: "invalid_domain" });
    return;
  }
  if (!isValidLabel(subdomain)) {
    res.status(400).json({ error: "invalid_subdomain" });
    return;
  }

  const discovery = await discoverDomainConnect(domain);
  const tier: DnsTier = discovery.supported ? "domain_connect" : "manual";

  res.json({
    tier,
    provider: discovery.providerId ?? null,
    applyUrl: discovery.supported
      ? buildApplyUrl({
          urlSyncUX: discovery.settings!.urlSyncUX!,
          domain,
          subdomain,
        })
      : null,
    cname: manualInstructions(`${subdomain}.${domain}`),
  });
});

// POST /api/domains — commit the choice: create the Cloudflare Custom Hostname,
// run discovery, persist, and return the next step (one-click apply URL or
// manual CNAME). Idempotent per user (one row).
domainsRouter.post("/", verifyToken, async (req, res) => {
  const { rootDomain, subdomainLabel } = req.body as {
    rootDomain?: string;
    subdomainLabel?: string;
  };

  const domain = toBareDomain(rootDomain ?? "");
  const label = (subdomainLabel ?? "blog").toLowerCase();

  if (!isValidDomain(domain)) {
    res.status(400).json({ error: "invalid_domain" });
    return;
  }
  if (!isValidLabel(label)) {
    res.status(400).json({ error: "invalid_subdomain" });
    return;
  }

  const fullHostname = `${label}.${domain}`;

  // Create the Cloudflare for SaaS Custom Hostname (best-effort; cert issues
  // once the CNAME resolves). If CF isn't configured yet, persist without it.
  let cfId: string | null = null;
  try {
    const ch = await createCustomHostname(fullHostname);
    cfId = ch.id;
  } catch (err) {
    logger.error({ err, fullHostname }, "createCustomHostname failed");
  }

  const discovery = await discoverDomainConnect(domain);
  const tier: DnsTier = discovery.supported ? "domain_connect" : "manual";

  const userId = req.user!.userId;
  const values = {
    userId,
    subdomainLabel: label,
    fullHostname,
    rootDomain: domain,
    cfCustomHostnameId: cfId,
    status: "pending" as DomainStatus,
    dnsTier: tier,
    dnsProvider: discovery.providerId ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(domains)
    .values(values)
    .onConflictDoUpdate({ target: domains.userId, set: values });

  res.json({
    fullHostname,
    tier,
    provider: discovery.providerId ?? null,
    applyUrl: discovery.supported
      ? buildApplyUrl({
          urlSyncUX: discovery.settings!.urlSyncUX!,
          domain,
          subdomain: label,
          state: userId,
        })
      : null,
    cname: manualInstructions(fullHostname),
  });
});

// GET /api/domains/check-dns — live DNS lookup of the customer's CNAME, so we
// can tell immediately whether the record actually exists (rather than letting
// the user click "I've added it" and then spin waiting for a cert that will
// never issue). Note: a Cloudflare-proxied (orange-cloud) record hides the
// CNAME from public DNS, so `found: false` doesn't always mean "missing" — the
// UI offers a "verify anyway" path that falls back to Cloudflare's own check.
domainsRouter.get("/check-dns", verifyToken, async (req, res) => {
  const existing = await db.query.domains.findFirst({
    where: eq(domains.userId, req.user!.userId),
  });
  if (!existing) {
    res.status(404).json({ error: "no_domain" });
    return;
  }

  const target = env.cloudflareFallbackOrigin.toLowerCase().replace(/\.$/, "");
  let observed: string[] = [];
  try {
    const cnames = await resolveCname(existing.fullHostname);
    observed = cnames.map((c) => c.toLowerCase().replace(/\.$/, ""));
  } catch {
    // ENODATA/ENOTFOUND/SERVFAIL → no public CNAME (not added, still
    // propagating, or proxied). Leave observed empty.
  }
  const found = observed.some((c) => c === target || c.endsWith(`.${target}`));
  res.json({ found, target, observed });
});

// GET /api/domains/status — poll endpoint; refreshes from Cloudflare.
domainsRouter.get("/status", verifyToken, async (req, res) => {
  const existing = await db.query.domains.findFirst({
    where: eq(domains.userId, req.user!.userId),
  });
  if (!existing) {
    res.status(404).json({ error: "no_domain" });
    return;
  }
  const row = await refreshStatus(existing);
  res.json({ status: row.status, lastError: row.lastError });
});

// GET /api/domains/domain-connect/callback — DNS host redirects here after the
// customer authorizes. The CNAME now exists; bounce them back to the frontend,
// where the status poller takes over.
domainsRouter.get("/domain-connect/callback", async (req, res) => {
  const state = String(req.query.state ?? "");
  if (state) {
    const existing = await db.query.domains.findFirst({
      where: eq(domains.userId, state),
    });
    if (existing && existing.cfCustomHostnameId) {
      await refreshStatus(existing);
    }
  }
  res.redirect(`${env.frontendUrl}/onboarding/domain?connected=1`);
});
