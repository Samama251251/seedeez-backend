import { google } from "googleapis";
import { env } from "../config/env.js";

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.oauthRedirectUri,
  );
}

export function getAuthUrl(client: ReturnType<typeof createOAuth2Client>) {
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
  });
}

export function decodeIdToken(idToken: string): {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
} {
  const part = idToken.split(".")[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };
  } catch {
    return {};
  }
}

function createGscClient(refreshToken: string) {
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return google.webmasters({ version: "v3", auth: client });
}

function dateRange(days: number): { startDate: string; endDate: string } {
  const fmt = (d: Date) => d.toISOString().split("T")[0]!;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function getGscStats(
  refreshToken: string,
  siteUrl: string,
  days: 7 | 28 | 90 = 28,
) {
  const gsc = createGscClient(refreshToken);
  const base = dateRange(days);

  const [trendRes, queriesRes, pagesRes, devicesRes, countriesRes] =
    await Promise.all([
      gsc.searchanalytics.query({
        siteUrl,
        requestBody: { ...base, dimensions: ["date"], rowLimit: days },
      }),
      gsc.searchanalytics.query({
        siteUrl,
        requestBody: { ...base, dimensions: ["query"], rowLimit: 50 },
      }),
      gsc.searchanalytics.query({
        siteUrl,
        requestBody: { ...base, dimensions: ["page"], rowLimit: 10 },
      }),
      gsc.searchanalytics.query({
        siteUrl,
        requestBody: { ...base, dimensions: ["device"], rowLimit: 3 },
      }),
      gsc.searchanalytics.query({
        siteUrl,
        requestBody: { ...base, dimensions: ["country"], rowLimit: 5 },
      }),
    ]);

  return {
    trend: trendRes.data.rows ?? [],
    queries: queriesRes.data.rows ?? [],
    pages: pagesRes.data.rows ?? [],
    devices: devicesRes.data.rows ?? [],
    countries: countriesRes.data.rows ?? [],
  };
}

export async function listGscSites(refreshToken: string) {
  const gsc = createGscClient(refreshToken);
  const res = await gsc.sites.list();
  return (res.data.siteEntry ?? []).filter(
    (s) => s.permissionLevel !== "siteUnverifiedUser",
  );
}
