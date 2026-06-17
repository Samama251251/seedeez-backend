import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  refreshToken: text("refresh_token").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const onboarding = pgTable("onboarding", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  siteUrl: text("site_url").notNull().default(""),
  niche: text("niche").notNull().default(""),
  competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// How a customer's blog attaches to a subdomain of their own domain.
// See docs/custom-domains.md. The working CNAME (blog.theirs.com →
// cname.seedeez.com) is itself the ownership proof; Cloudflare for SaaS
// issues the per-hostname cert. One row per user for v1.
export type DomainStatus = "pending" | "active" | "failed";
export type DnsTier = "domain_connect" | "manual" | "concierge";

export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // e.g. "blog" — the label the customer picked; default "blog".
  subdomainLabel: text("subdomain_label").notNull().default("blog"),
  // Full hostname we serve, e.g. "blog.theirs.com". Tenant routing key.
  fullHostname: text("full_hostname").notNull().unique(),
  // Bare apex of the customer's domain, e.g. "theirs.com" (used for DNS discovery).
  rootDomain: text("root_domain").notNull(),
  // Cloudflare for SaaS Custom Hostname id, set once we create it.
  cfCustomHostnameId: text("cf_custom_hostname_id"),
  status: text("status").$type<DomainStatus>().notNull().default("pending"),
  // Which tier actually connected the domain (analytics + support).
  dnsTier: text("dns_tier").$type<DnsTier>(),
  // Detected from _domainconnect discovery — log from day one to learn the
  // real provider distribution and prioritize automation against data.
  dnsProvider: text("dns_provider"),
  // Last error surfaced by Cloudflare DCV / validation, for support.
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
