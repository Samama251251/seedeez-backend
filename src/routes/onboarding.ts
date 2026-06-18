import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, onboarding } from "../db/schema/index.js";
import { verifyToken } from "../middleware/auth.js";
import { listGscSites } from "../lib/google.js";
import { suggestNicheAndCompetitors } from "../lib/groq.js";
import { fetchSiteText } from "../lib/scrape.js";
import { logger } from "../lib/logger.js";

function toBareDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export const onboardingRouter = Router();

onboardingRouter.get("/gsc-sites", verifyToken, async (req, res) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.user!.userId),
    });
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const sites = await listGscSites(user.refreshToken);
    res.json({
      sites: sites.map((s) => ({
        siteUrl: s.siteUrl,
        permissionLevel: s.permissionLevel,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Failed to list GSC sites");
    res.status(502).json({ error: "gsc_error" });
  }
});

onboardingRouter.post("/suggest", verifyToken, async (req, res) => {
  const { siteUrl } = req.body as { siteUrl?: string };

  if (!siteUrl) {
    res.status(400).json({ error: "siteUrl is required" });
    return;
  }

  const domain = toBareDomain(siteUrl);
  const siteText = await fetchSiteText(domain);
  const suggestion = await suggestNicheAndCompetitors(domain, siteText);
  res.json(suggestion);
});

onboardingRouter.post("/", verifyToken, async (req, res) => {
  const { siteUrl, niche, competitors } = req.body as {
    siteUrl?: string;
    niche?: string;
    competitors?: string[];
  };

  if (!siteUrl || !niche) {
    res.status(400).json({ error: "siteUrl and niche are required" });
    return;
  }

  const existing = await db.query.onboarding.findFirst({
    where: eq(onboarding.userId, req.user!.userId),
  });

  if (existing) {
    await db
      .update(onboarding)
      .set({ siteUrl, niche, competitors: competitors ?? [], completedAt: new Date() })
      .where(eq(onboarding.userId, req.user!.userId));
  } else {
    await db.insert(onboarding).values({
      userId: req.user!.userId,
      siteUrl,
      niche,
      competitors: competitors ?? [],
      completedAt: new Date(),
    });
  }

  res.json({ ok: true });
});
