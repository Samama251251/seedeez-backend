import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? "3001", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  oauthRedirectUri: required("OAUTH_REDIRECT_URI"),
  jwtSecret: required("JWT_SECRET"),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  groqApiKey: process.env.GROQ_API_KEY,
} as const;
