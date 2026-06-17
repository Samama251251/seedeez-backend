import { Resolver } from "node:dns/promises";
import { createSign } from "node:crypto";
import { env } from "../config/env.js";

// Bounded DNS resolver: a domain without a _domainconnect record must fail fast
// (fall back to manual tier) instead of hanging the connect request. Without
// this, an un-DC domain can stall the whole POST for 15-30s.
const DNS_TIMEOUT_MS = 2500;
const SETTINGS_TIMEOUT_MS = 3000;
const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });

// Domain Connect — we act as the Service Provider. We discover the customer's
// DNS host, confirm it supports the synchronous (urlSyncUX) flow, and build a
// signed /apply redirect that writes `CNAME {subdomain} -> cname.seedeez.com`
// on their behalf. The customer only clicks "Authorize" on their DNS host.
//
// Templates are onboarded with each provider ONCE (not applied dynamically).
// The sig/key params sign the open variables (the subdomain label) so a
// provider can verify the request really came from us. See docs/custom-domains.md.
// Spec: https://github.com/Domain-Connect/spec

export interface DomainConnectSettings {
  providerId: string;
  providerName?: string;
  urlSyncUX?: string;
  urlAsyncUX?: string;
  urlAPI?: string;
  width?: number;
  height?: number;
}

export interface DomainConnectDiscovery {
  // true when the domain has Domain Connect enabled AND the sync flow is usable.
  supported: boolean;
  // Bare domain we looked up, e.g. "theirs.com".
  domain: string;
  // urlPrefix from the _domainconnect TXT record, e.g. "domainconnect.api.godaddy.com".
  urlPrefix?: string;
  settings?: DomainConnectSettings;
  // providerId, e.g. "godaddy.com" / "cloudflare.com" — drives our onboarding gate.
  providerId?: string;
}

// Providers we have onboarded our template with. A domain is only one-click if
// its providerId is in here AND discovery succeeds. Everything else -> Tier 2.
// Keep this in sync with the templates actually merged + onboarded.
const ONBOARDED_PROVIDER_IDS = new Set<string>([
  // "godaddy.com",   // enable once domainconnect@godaddy.com confirms onboarding
  // "cloudflare.com",
]);

// Step 1: discover the DNS host's API root from the _domainconnect TXT record.
async function discoverUrlPrefix(domain: string): Promise<string | null> {
  try {
    const records = await resolver.resolveTxt(`_domainconnect.${domain}`);
    // resolveTxt returns string[][] (chunks per record); join chunks, take first.
    const value = records[0]?.join("").trim();
    return value || null;
  } catch {
    // NXDOMAIN / no TXT / timeout => Domain Connect not enabled for this domain.
    return null;
  }
}

// Step 2: fetch the provider's settings to confirm the synchronous flow exists.
async function fetchSettings(
  urlPrefix: string,
  domain: string,
): Promise<DomainConnectSettings | null> {
  const base = urlPrefix.startsWith("http") ? urlPrefix : `https://${urlPrefix}`;
  try {
    const res = await fetch(`${base}/v2/${domain}/settings`, {
      signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as DomainConnectSettings;
  } catch {
    return null;
  }
}

// Full discovery: TXT lookup -> settings fetch -> onboarding gate.
export async function discoverDomainConnect(
  domain: string,
): Promise<DomainConnectDiscovery> {
  const urlPrefix = await discoverUrlPrefix(domain);
  if (!urlPrefix) return { supported: false, domain };

  const settings = await fetchSettings(urlPrefix, domain);
  if (!settings || !settings.urlSyncUX) {
    return { supported: false, domain, urlPrefix };
  }

  const supported = ONBOARDED_PROVIDER_IDS.has(settings.providerId);
  return {
    supported,
    domain,
    urlPrefix,
    settings,
    providerId: settings.providerId,
  };
}

// Sign the query string with our private key. The provider verifies it against
// the public key it fetches from `key` (our syncPubKeyDomain TXT). Required
// because our template has an open variable (the subdomain label).
function signParams(queryString: string): string | null {
  const privateKey = env.domainConnect.privateKey;
  if (!privateKey) return null;
  const signer = createSign("RSA-SHA256");
  signer.update(queryString);
  signer.end();
  return signer.sign(privateKey, "base64");
}

export interface ApplyUrlInput {
  // The customer's DNS host sync UX base, from discovery settings.urlSyncUX.
  urlSyncUX: string;
  // Bare domain, e.g. "theirs.com".
  domain: string;
  // Subdomain label, e.g. "blog" — the open variable.
  subdomain: string;
  // Optional state echoed back to our callback to re-associate the user.
  state?: string;
}

// Step 3: build the signed /apply redirect. Sending the customer here pops the
// provider's "Authorize DNS records from seedeez" consent screen, which writes
// the CNAME and redirects back to our callback.
export function buildApplyUrl(input: ApplyUrlInput): string {
  const { providerId, serviceId, syncPubKeyDomain, redirectUri } =
    env.domainConnect;

  const params = new URLSearchParams();
  params.set("domain", input.domain);
  // Template variable: maps to `CNAME {subdomain} -> cname.seedeez.com`.
  params.set("subdomain", input.subdomain);
  params.set("redirect_uri", redirectUri);
  if (input.state) params.set("state", input.state);

  // Sign before appending sig/key (the signature covers the open variables).
  const sig = signParams(params.toString());
  if (sig && syncPubKeyDomain) {
    params.set("sig", sig);
    params.set("key", syncPubKeyDomain);
  }

  const base = input.urlSyncUX.replace(/\/+$/, "");
  return `${base}/v2/domainTemplates/providers/${providerId}/services/${serviceId}/apply?${params.toString()}`;
}
