CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subdomain_label" text DEFAULT 'blog' NOT NULL,
	"full_hostname" text NOT NULL,
	"root_domain" text NOT NULL,
	"cf_custom_hostname_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_tier" text,
	"dns_provider" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domains_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "domains_full_hostname_unique" UNIQUE("full_hostname")
);
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;