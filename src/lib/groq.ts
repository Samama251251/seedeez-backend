import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface OnboardingSuggestion {
  niche: string;
  competitors: string[];
}

const EMPTY: OnboardingSuggestion = { niche: "", competitors: [] };

export async function suggestNicheAndCompetitors(domain: string): Promise<OnboardingSuggestion> {
  if (!env.groqApiKey) return EMPTY;

  try {
    const client = new Groq({ apiKey: env.groqApiKey });

    const completion = await client.chat.completions.create({
      model: "groq/compound",
      messages: [
        {
          role: "system",
          content:
            "You research businesses from their domain name using web search. " +
            "Respond with ONLY a JSON object, no markdown, no commentary, in the form " +
            '{"niche": "short description of the business niche", "competitors": ["competitor1.com", ...]}. ' +
            "The niche should be a concise phrase (e.g. 'B2B SaaS project management tools'). " +
            "competitors must be exactly 5 real companies that directly compete with this business, " +
            "given as bare domain names (no protocol, no www).",
        },
        {
          role: "user",
          content: `Domain: ${domain}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return EMPTY;

    const parsed = JSON.parse(match[0]) as Partial<OnboardingSuggestion>;
    const niche = typeof parsed.niche === "string" ? parsed.niche.trim() : "";
    const competitors = Array.isArray(parsed.competitors)
      ? parsed.competitors.filter((c): c is string => typeof c === "string").slice(0, 5)
      : [];

    return { niche, competitors };
  } catch (err) {
    logger.error({ err }, "Failed to get Groq onboarding suggestion");
    return EMPTY;
  }
}
