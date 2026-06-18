import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, onboarding, domains } from "../db/schema/index.js";
import { verifyToken } from "../middleware/auth.js";

export const meRouter = Router();

meRouter.get("/", verifyToken, async (req, res) => {
  const [user, ob, domain] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, req.user!.userId) }),
    db.query.onboarding.findFirst({ where: eq(onboarding.userId, req.user!.userId) }),
    db.query.domains.findFirst({ where: eq(domains.userId, req.user!.userId) }),
  ]);

  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    onboarded: !!ob?.completedAt,
    site: ob?.completedAt
      ? { siteUrl: ob.siteUrl, niche: ob.niche, competitors: ob.competitors }
      : null,
    // Domain connection summary so the app can gate on it and show status.
    domain: domain
      ? { status: domain.status, fullHostname: domain.fullHostname }
      : null,
  });
});
