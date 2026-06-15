import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { env } from "./config/env.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { meRouter } from "./routes/me.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { adminRouter } from "./routes/admin.js";

export const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(pinoHttp({ logger }));

app.use("/api", healthRouter);
app.use("/auth", authRouter);
app.use("/api/me", meRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/admin", adminRouter);
