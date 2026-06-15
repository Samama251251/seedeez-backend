import { Router } from "express";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { users, onboarding } from "../db/schema/index.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { createOAuth2Client, decodeIdToken, getAuthUrl } from "../lib/google.js";

export const authRouter = Router();

authRouter.get("/google", (_req, res) => {
  const client = createOAuth2Client();
  res.redirect(getAuthUrl(client));
});

authRouter.get("/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "missing_code" });
      return;
    }

    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      res.status(400).json({ error: "no_id_token" });
      return;
    }

    const profile = decodeIdToken(tokens.id_token);
    if (!profile.sub || !profile.email) {
      res.status(400).json({ error: "invalid_id_token" });
      return;
    }

    let user = await db.query.users.findFirst({
      where: eq(users.googleSub, profile.sub),
    });

    if (!user) {
      if (!tokens.refresh_token) {
        res.redirect(`${env.frontendUrl}/error?reason=no_refresh_token`);
        return;
      }
      [user] = await db
        .insert(users)
        .values({
          googleSub: profile.sub,
          email: profile.email,
          name: profile.name ?? null,
          avatarUrl: profile.picture ?? null,
          refreshToken: tokens.refresh_token,
        })
        .returning();
    } else {
      const update: Record<string, unknown> = {
        email: profile.email,
        name: profile.name ?? null,
        avatarUrl: profile.picture ?? null,
        updatedAt: new Date(),
      };
      if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
      [user] = await db
        .update(users)
        .set(update)
        .where(eq(users.id, user.id))
        .returning();
    }

    const ob = await db.query.onboarding.findFirst({
      where: eq(onboarding.userId, user.id),
    });

    const token = jwt.sign(
      { userId: user.id, isAdmin: user.isAdmin },
      env.jwtSecret,
      { expiresIn: "30d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: env.nodeEnv === "production",
      sameSite: env.nodeEnv === "production" ? "none" : "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${env.frontendUrl}${ob?.completedAt ? "/dashboard" : "/onboarding"}`);
  } catch (err) {
    logger.error({ err }, "OAuth callback failed");
    res.redirect(`${env.frontendUrl}/error?reason=auth_failed`);
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: env.nodeEnv === "production" ? "none" : "lax",
  });
  res.json({ ok: true });
});
