import { env } from "../config/env.js";
import { logger } from "./logger.js";

const ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 8000;

// Result hosts that are never a competitor's own site — social, marketplaces,
// app stores, aggregators, encyclopedias, etc.
const JUNK_HOSTS = new Set([
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "tiktok.com",
  "medium.com",
  "wikipedia.org",
  "play.google.com",
  "apps.apple.com",
  "amazon.com",
  "github.com",
  "wordpress.com",
  "blogspot.com",
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "crunchbase.com",
  // Pure listing / "competitor lookup" aggregators that rank for these
  // queries but are never themselves a competitor. (Note: we deliberately do
  // NOT list product sites like semrush/similarweb here — for some niches
  // those are real competitors.)
  "zoominfo.com",
  "siteprice.org",
  "owler.com",
  "producthunt.com",
]);

interface TavilyResult {
  url: string;
  title?: string;
  content?: string;
}

function hostToDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

// True if `host` is, or is a subdomain of, the user's own root domain.
function isOwnDomain(host: string, rootDomain: string): boolean {
  const h = hostToDomain(host);
  return h === rootDomain || h.endsWith(`.${rootDomain}`);
}

async function search(query: string): Promise<TavilyResult[]> {
  if (!env.tavilyApiKey) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.tavilyApiKey}`,
      },
      body: JSON.stringify({ query, max_results: 10, search_depth: "basic" }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, query }, "Tavily search failed");
      return [];
    }
    const json = (await res.json()) as { results?: TavilyResult[] };
    return json.results ?? [];
  } catch (err) {
    logger.error({ err, query }, "Tavily search error");
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find candidate competitor domains for a business via web search. Runs a
 * couple of queries, extracts the result hostnames, and returns a deduped list
 * of real, existing domains with the user's own site and common aggregators
 * filtered out. Never throws; returns [] if Tavily isn't configured or fails.
 */
export async function findCompetitorCandidates(
  rootDomain: string,
  niche: string,
): Promise<string[]> {
  // Niche-driven queries are far more relevant than domain-anchored ones:
  // for lesser-known brands "<domain> competitors" returns SEO/analytics junk,
  // whereas "best <niche> websites" surfaces the real players in the space.
  const queries = niche
    ? [`best ${niche} websites`, `top ${niche} platforms`]
    : [`${rootDomain} competitors`, `alternatives to ${rootDomain}`];

  const resultsPerQuery = await Promise.all(queries.map(search));
  const seen = new Set<string>();
  const domains: string[] = [];

  for (const results of resultsPerQuery) {
    for (const r of results) {
      let host: string;
      try {
        host = new URL(r.url).hostname;
      } catch {
        continue;
      }
      const domain = hostToDomain(host);
      if (!domain || seen.has(domain)) continue;
      if (JUNK_HOSTS.has(domain)) continue;
      if (isOwnDomain(host, rootDomain)) continue;
      seen.add(domain);
      domains.push(domain);
    }
  }

  return domains.slice(0, 12);
}
