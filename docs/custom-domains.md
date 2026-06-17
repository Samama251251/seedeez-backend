# Custom Domains — Onboarding & DNS Design

How seedeez attaches a customer's blog to a subdomain of **their** domain
(`blog.theirs.com`) and serves SEO/GEO content there. This is the design of
record; decisions below are locked unless explicitly revisited.

---

## 1. Core model

| Decision | Choice |
|---|---|
| **Placement** | Subdomain `blog.theirs.com` (customer picks label, default `blog`) |
| **Hosting** | Multi-tenant — we host the blog; customer adds one DNS record |
| **Serving + TLS** | **Cloudflare for SaaS** (Custom Hostnames) |
| **Rendering** | Worker SSRs per request, routed by `Host` header → tenant lookup |
| **Ownership proof** | The working CNAME **is** the proof — no separate TXT |
| **Domain source** | Prefilled from the customer's GSC-verified site (already in onboarding) |
| **Domain policy** | Custom domain is **required** during onboarding (no `*.seedeez.com` fallback) |

### Why subdomain (not subdirectory)
Subdirectory (`theirs.com/blog`) is better for SEO authority but needs a reverse
proxy / rewrite at the customer's edge — not one-click, and impossible to make
frictionless across hosts. Subdomain is one CNAME + auto-TLS. We chose
frictionless onboarding over the marginal SEO authority gain.

### Three independent things (do not conflate)
- **Registrar** — where the domain was bought (GoDaddy, Namecheap…).
- **DNS host (nameservers)** — who answers DNS for the domain. May be delegated
  to Cloudflare / Vercel / Route53. **This is the only thing that matters for us** —
  it's where the CNAME gets written.
- **Web host** — Vercel, Netlify, WordPress. **Irrelevant** — `blog.` is a brand
  new hostname their existing site never touches.

---

## 2. Serving + TLS: Cloudflare for SaaS

- Customer sets `CNAME blog → cname.seedeez.com` (our fallback origin).
- Cloudflare for SaaS issues + renews the per-hostname cert (DCV).
- Origin is a Cloudflare Worker. On each request: read `Host` header →
  look up tenant by `full_hostname` → SSR their content.
- Chosen over Vercel for Platforms because we already deploy via wrangler,
  it's the cheapest per-tenant model (~$0.10/hostname/mo), and serving by
  `Host` header is clean. (Vercel for Platforms only wins if we'd rather author
  the blog as a Next.js-on-Vercel app and accept its cost model.)

---

## 3. The DNS gate — three tiers

The custom domain is required to finish onboarding, so the DNS step is a blocking
gate. It degrades gracefully across three tiers.

### Tier 1 — One-click (Domain Connect)
We act as a Domain Connect **Service Provider** and redirect the customer to their
DNS host's "Authorize" page, which writes the CNAME for them.

**v1 one-click providers: Cloudflare + GoDaddy (both confirmed live).**

Key mechanism: templates are **onboarded with each DNS provider once** (they are
NOT applied dynamically). The `sig`/`key` params only sign the *open variables*
(e.g. the subdomain label) to mitigate phishing — they don't bypass onboarding.
Once onboarded with a provider, it's one-click for every customer on that provider.

- **Cloudflare** — ✅ confirmed (live artifact). Bonus: sets **Proxy status = DNS
  only automatically**, eliminating the grey/orange-cloud gotcha on this path.
- **GoDaddy** — ✅ confirmed via live settings probe. `domainconnect.api.godaddy.com`
  `/v2/<domain>/settings` returns `urlSyncUX: https://dcc.godaddy.com/manage`, i.e.
  the synchronous one-click flow is supported.
  - ⚠️ Earlier confusion: the API host is `domainconnect.api.godaddy.com` (NOT
    `domainconnect.godaddy.com`, which 404s). And the `_domainconnect` discovery
    TXT only exists when DC is *enabled* for that domain (e.g. `coolexample.com`
    has it; some domains don't) — those fall back to Tier 2.

**Onboarding (one-time setup per provider):** see `domain-connect/README.md`;
template lives at `domain-connect/seedeez.com.blog.json`.
1. Write template `seedeez.com.blog.json` — CNAME `{subdomain}` → `cname.seedeez.com`,
   subdomain as a variable. ✅ drafted. Test in the online editor
   (domainconnect.paulonet.eu/dc/free/templateedit).
2. Sign it — publish public key as a TXT (`syncPubKeyDomain`), sign apply requests
   (required because the template has an open variable).
3. PR it to `github.com/Domain-Connect/Templates` (`providerId.serviceId.json`).
4. Onboard with each provider: **GoDaddy → email `domainconnect@godaddy.com`**
   (human process, has lead time — start early); Cloudflare per their DC reference
   (developers.cloudflare.com/dns/reference/domain-connect).

**Runtime (per customer, automated):**
1. `dig TXT _domainconnect.<domain>` → urlPrefix (GoDaddy: `domainconnect.api.godaddy.com`).
2. `GET {urlPrefix}/v2/<domain>/settings` → `urlSyncUX`, `providerId`.
3. Redirect to
   `{urlSyncUX}/v2/domainTemplates/providers/seedeez.com/services/blog/apply?domain=…&subdomain=blog&sig=…&key=…&redirect_uri=…`
4. Provider shows Authorize page → writes CNAME → redirects back.

**Gating logic (self-correcting):** discovery TXT present + provider onboarded →
one-click; otherwise → Tier 2 manual. No domain dead-ends.

**What we build to be a Service Provider:**
1. Publish a Domain Connect **template** (JSON) describing the record(s):
   `CNAME {subdomain} → cname.seedeez.com`. (No verify TXT — CNAME is proof.)
2. Generate a **keypair**; publish the public key as a TXT record
   (`_dcpubkeyv1.seedeez.com`).
3. **Sign** each apply request with the private key (`sig` + `key` params).
4. **Discovery:** look up `_domainconnect.<domain>` TXT → get the DNS host's API
   root → confirm template support → redirect to the signed `/apply` URL.
5. Handle the `redirect_uri` callback; provider shows its own consent UI and
   writes the record.

Use the **synchronous (redirect + signature) flow** — no OAuth/async needed, since
we only add the record once.

> Reference flow observed in the wild (Vercel → Cloudflare):
> `dash.cloudflare.com/domainconnect/v2/domainTemplates/providers/<provider>/services/<service>/apply?domain=…&subdomain=…&cname=…&sig=…&key=_dcpubkeyv1`
> Vercel is the Service Provider; Cloudflare is the DNS host applying the template.

### Tier 2 — Manual CNAME + verify
Everyone Domain Connect doesn't cover (Namecheap, Vercel-DNS, the long tail).

- Show the exact record (`CNAME blog → cname.seedeez.com`), copy-paste, plus
  per-provider screenshots.
- **Show the grey-cloud / "DNS only" warning** — this gotcha only bites on the
  manual path (Tier 1 Cloudflare sets it automatically).
- Poll DNS until the record resolves, then proceed to validation.

### Tier 3 — Concierge (no credentials)
When Tier 1 + Tier 2 both fail.

- **Delegation link** — "Send setup instructions to whoever manages your DNS."
  Generates a shareable link/email with the exact record + steps. Handles the
  most common blocker: the person onboarding isn't the person who controls DNS.
- **Support thread** — human help for misconfigured records / propagation
  confusion.
- **Scoped API token** — only on explicit request; revocable; we hold it briefly,
  write the record, revoke. Not the default — keeps credential custody off our books.

---

## 4. Timing / UX (async)

The required domain must never become a multi-hour wall.

1. Customer triggers the DNS change (Tier 1/2/3).
2. We create the Custom Hostname in Cloudflare for SaaS and **poll its status**.
3. Meanwhile the customer **keeps moving** — generate/preview content on an
   internal URL.
4. When Cloudflare reports the hostname **active + cert issued**, we **flip live
   and notify** (email / in-app). `blog.theirs.com` now serves.

---

## 5. Out of scope (handled gracefully)

- **`*.vercel.app` / `*.netlify.app` / `*.github.io`-only companies** — they have
  no DNS control, so they can't onboard. Show a clear **"connect a custom domain
  to continue"** message (not a dead end). Justified: SEO/GEO on a platform
  subdomain has no brand and no domain authority — these aren't target customers.
- **Entri** (paid Domain Connect automation) — deferred. Revisit only if drop-off
  data shows the DNS step is a conversion killer worth paying to fix.
- **Cloudflare-specific API integration** — deferred. Domain Connect already gives
  Cloudflare one-click *with* auto DNS-only; a direct API only earns its place
  later for richer multi-record automation.

---

## 6. Implementation notes

### Data model
New `domains` table (or extend `onboarding`):

| Column | Notes |
|---|---|
| `subdomain_label` | e.g. `blog`; validated; default `blog` |
| `full_hostname` | `blog.theirs.com`; unique; tenant routing key |
| `cf_custom_hostname_id` | Cloudflare for SaaS hostname id |
| `status` | `pending` / `active` / `failed` |
| `dns_provider` | Detected from `_domainconnect` lookup — **log from day one** to learn the real provider distribution and prioritize future automation against data, not guesses |
| `created_at` / `updated_at` | |

### Services to build
- **Cloudflare for SaaS client** — fallback origin setup, Custom Hostname create,
  status poll, DCV.
- **Domain Connect Service Provider** — template JSON, keypair, public-key TXT,
  request signing, discovery client, redirect callback.
- **Validation poller + activation notifier** — flips `status` → `active`, notifies.
- **Worker host router** — `Host` header → tenant → SSR.

### Open items to verify before building
- **GoDaddy template onboarding lead time** — GoDaddy one-click is confirmed
  available (settings probe shows `urlSyncUX`), but onboarding the template is a
  human process via `domainconnect@godaddy.com`. Kick this off early; it's the
  only non-instant dependency.
- Confirm Cloudflare's template onboarding process (per their DC reference).
- Cloudflare for SaaS pricing/plan at expected tenant count.

---

## 7. Onboarding flow (end to end)

1. **Sign in with Google** *(exists)* → GSC readonly scope.
2. **Pick your site** from GSC-verified list *(exists)* → this is `theirs.com`,
   ownership already proven to Google; prefill it.
3. **Niche + competitors** suggestion *(exists)*.
4. **Choose subdomain label** *(new)* → default `blog`, editable, validated.
5. **Connect domain** *(new)* → Tier 1 (Cloudflare/GoDaddy one-click) →
   Tier 2 (manual) → Tier 3 (concierge).
6. **Background validation** *(new)* → create CF Custom Hostname, poll; customer
   keeps moving on content meanwhile.
7. **Flip live + notify** *(new)* → `blog.theirs.com` serves, SSR by `Host`.
8. **Publishing** proceeds.
