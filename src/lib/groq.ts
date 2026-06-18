import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { findCompetitorCandidates } from "./tavily.js";

export interface OnboardingSuggestion {
  niche: string;
  competitors: string[];
}

const EMPTY: OnboardingSuggestion = { niche: "", competitors: [] };

// Groq's compound web-search 413s on the free tier (it ingests fetched pages
// past the per-request token cap) and otherwise pattern-guesses domains. So we
// split the work and use a dedicated search API for the part that needs the web:
//   1. niche  — derived from the scraped homepage by a plain 70B model
//               (no tools, deterministic, generous input allowed).
//   2. competitors — Tavily returns real candidate domains from live search;
//               the 70B model then ranks the 5 most direct competitors from
//               that real list (so the output can't be hallucinated).

// Derive a concise niche phrase from the scraped homepage. No web search.
async function deriveNiche(
  client: Groq,
  domain: string,
  siteText?: string,
): Promise<string> {
  try {
    const excerpt = (siteText ?? "").slice(0, 4000);
    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_completion_tokens: 64,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are given a website's domain and homepage text. Reply with ONLY a short " +
            "phrase (max 12 words) naming the business's niche — e.g. " +
            "'B2B SaaS project management tools' or 'Online MDCAT exam prep'. " +
            "No quotes, no punctuation at the end, no extra words.",
        },
        {
          role: "user",
          content: excerpt
            ? `Domain: ${domain}\n\nHomepage:\n${excerpt}`
            : `Domain: ${domain}`,
        },
      ],
    });
    return (completion.choices[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    logger.error({ err }, "deriveNiche failed");
    return "";
  }
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

// Given real candidate domains from search, have the 70B model pick the 5 most
// direct competitors. The model may only choose from the provided list, so the
// result is always real, existing domains — never hallucinated.
async function rankCompetitors(
  client: Groq,
  domain: string,
  niche: string,
  candidates: string[],
): Promise<string[]> {
  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_completion_tokens: 128,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are given a business and a list of candidate competitor domains found via web " +
            "search. Pick the (up to) 5 that are the most direct competitors. Use ONLY domains " +
            "from the provided list — do not invent any. Respond with ONLY a JSON array of bare " +
            'domains, e.g. ["a.com","b.io"].',
        },
        {
          role: "user",
          content: `Business: ${domain}${niche ? ` (niche: ${niche})` : ""}\n\nCandidate domains:\n${candidates.join("\n")}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const arrays = content.match(/\[[^[\]]*\]/g);
    if (!arrays?.length) return [];
    const parsed = JSON.parse(arrays[arrays.length - 1]) as unknown;
    if (!Array.isArray(parsed)) return [];
    const allowed = new Set(candidates);
    return parsed
      .filter((c): c is string => typeof c === "string")
      .map(normalizeDomain)
      .filter((d) => allowed.has(d)) // guard against any invented entries
      .slice(0, 5);
  } catch (err) {
    logger.error({ err }, "rankCompetitors failed");
    return [];
  }
}

// Find 5 direct competitors: Tavily surfaces real candidate domains, the 70B
// model ranks the best 5 from that list. Falls back to the candidate order if
// ranking fails, and returns [] if search is unavailable.
async function findCompetitors(
  client: Groq,
  domain: string,
  niche: string,
): Promise<string[]> {
  const candidates = await findCompetitorCandidates(domain, niche);
  if (!candidates.length) return [];

  const ranked = await rankCompetitors(client, domain, niche, candidates);
  return ranked.length ? ranked : candidates.slice(0, 5);
}

export async function suggestNicheAndCompetitors(
  domain: string,
  siteText?: string,
): Promise<OnboardingSuggestion> {
  if (!env.groqApiKey) return EMPTY;

  const client = new Groq({ apiKey: env.groqApiKey });
  const niche = await deriveNiche(client, domain, siteText);
  const competitors = await findCompetitors(client, domain, niche);
  return { niche, competitors };
}
