import { Router } from "express";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, onboarding } from "../db/schema/index.js";
import { verifyToken } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getGscStats } from "../lib/google.js";
import { logger } from "../lib/logger.js";

export const adminRouter = Router();

adminRouter.use(verifyToken, requireAdmin);

adminRouter.get("/companies", async (_req, res) => {
  const companies = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      siteUrl: onboarding.siteUrl,
      niche: onboarding.niche,
      competitors: onboarding.competitors,
      completedAt: onboarding.completedAt,
    })
    .from(users)
    .innerJoin(onboarding, eq(onboarding.userId, users.id))
    .where(isNotNull(onboarding.completedAt));

  res.json({ companies });
});

adminRouter.get("/companies/:userId/dashboard", async (req, res) => {
  try {
    const { userId } = req.params;

    const [user, ob] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId) }),
      db.query.onboarding.findFirst({ where: eq(onboarding.userId, userId) }),
    ]);

    if (!user || !ob?.completedAt) {
      res.status(404).json({ error: "company_not_found" });
      return;
    }

    const days = ([7, 28, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 28) as 7 | 28 | 90;
    const stats = await getGscStats(user.refreshToken, ob.siteUrl, days);
    res.json({ site: ob.siteUrl, niche: ob.niche, competitors: ob.competitors, days, ...stats });
  } catch (err) {
    logger.error({ err }, "Admin dashboard fetch failed");
    res.status(502).json({ error: "gsc_error" });
  }
});
