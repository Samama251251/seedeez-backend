import { logger } from "./logger.js";

const TIMEOUT_MS = 5000;
const MAX_CHARS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Fetch a URL with a hard timeout and a desktop User-Agent. Returns the HTML
// body, or null on any non-2xx / network / timeout error.
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Pull a meta description (name= or property=) out of raw HTML, if present.
function extractMetaDescription(html: string): string {
  const match = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i,
  );
  if (!match) return "";
  const content = match[0].match(/content=["']([^"']*)["']/i);
  return content?.[1]?.trim() ?? "";
}

function extractTitle(html: string): string {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
}

// Strip scripts/styles/markup down to a flat run of visible text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a site's homepage and return a compact text summary (title +
 * description + body text), capped at MAX_CHARS. Best-effort: tries the bare
 * apex then the www host, and returns "" if both fail. Never throws.
 */
export async function fetchSiteText(bareDomain: string): Promise<string> {
  const domain = bareDomain.trim().toLowerCase();
  if (!domain) return "";

  try {
    const html =
      (await fetchHtml(`https://${domain}`)) ??
      (await fetchHtml(`https://www.${domain}`));
    if (!html) return "";

    const title = extractTitle(html);
    const description = extractMetaDescription(html);
    const body = htmlToText(html);

    const text = [
      title && `Title: ${title}`,
      description && `Description: ${description}`,
      body && `Content: ${body}`,
    ]
      .filter(Boolean)
      .join("\n");

    return text.slice(0, MAX_CHARS);
  } catch (err) {
    logger.error({ err, bareDomain }, "fetchSiteText failed");
    return "";
  }
}
