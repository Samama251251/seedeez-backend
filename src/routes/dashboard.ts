import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, onboarding } from "../db/schema/index.js";
import { verifyToken } from "../middleware/auth.js";
import { getGscStats } from "../lib/google.js";
import { logger } from "../lib/logger.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", verifyToken, async (req, res) => {
  try {
    const [user, ob] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }),
      db.query.onboarding.findFirst({ where: eq(onboarding.userId, req.user!.userId) }),
    ]);

    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    if (!ob?.completedAt) {
      res.status(403).json({ error: "onboarding_incomplete" });
      return;
    }

    const stats = await getGscStats(user.refreshToken, ob.siteUrl);
    res.json({ site: ob.siteUrl, niche: ob.niche, ...stats });
  } catch (err) {
    logger.error({ err }, "Dashboard fetch failed");
    res.status(502).json({ error: "gsc_error" });
  }
});
