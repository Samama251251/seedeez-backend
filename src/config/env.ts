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

  // Cloudflare for SaaS (Custom Hostnames) — serving + per-hostname TLS.
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID,
  // Fallback origin customers CNAME to, e.g. "cname.seedeez.com".
  cloudflareFallbackOrigin:
    process.env.CLOUDFLARE_FALLBACK_ORIGIN ?? "cname.seedeez.com",

  // Domain Connect — we act as the Service Provider that writes the CNAME.
  domainConnect: {
    providerId: process.env.DOMAIN_CONNECT_PROVIDER_ID ?? "seedeez.com",
    serviceId: process.env.DOMAIN_CONNECT_SERVICE_ID ?? "blog",
    // Domain holding our published public key TXT, e.g. "_dcpubkeyv1.seedeez.com".
    syncPubKeyDomain: process.env.DOMAIN_CONNECT_SYNC_PUBKEY_DOMAIN,
    // PEM private key used to sign apply requests (open variable = subdomain).
    privateKey: process.env.DOMAIN_CONNECT_PRIVATE_KEY,
    // Where the DNS provider redirects back after the customer authorizes.
    redirectUri:
      process.env.DOMAIN_CONNECT_REDIRECT_URI ??
      "http://localhost:3001/api/domains/domain-connect/callback",
  },
} as const;
