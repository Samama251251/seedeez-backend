import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error({ err }, "Health check DB ping failed");
    res.status(503).json({ status: "error", db: "unreachable", timestamp: new Date().toISOString() });
  }
});
