import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface JwtPayload {
  userId: string;
  isAdmin: boolean;
}

export function verifyToken(req: Request, res: Response, next: NextFunction): void {
  const token = (req.cookies as Record<string, string | undefined>)?.token;
  if (!token) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  try {
    req.user = jwt.verify(token, env.jwtSecret) as JwtPayload;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
