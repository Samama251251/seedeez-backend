# Domain Connect — Service Provider onboarding

We act as a Domain Connect **Service Provider**: we send the customer to their
DNS host's "Authorize" page, which writes `CNAME {subdomain} -> cname.seedeez.com`
for them (Tier 1, one-click). See `../docs/custom-domains.md` for the full design.

`seedeez.com.blog.json` is the template that describes that record. It uses an
**open variable** (`%subdomain%`), so apply requests **must be signed** — that's
why `syncPubKeyDomain` is set and why the backend signs with a private key.

## One-time setup

### 1. Generate the signing keypair
```sh
# Private key (keep secret — goes in DOMAIN_CONNECT_PRIVATE_KEY)
openssl genrsa -out dc-private.pem 2048

# Public key (gets published as TXT, see step 2)
openssl rsa -in dc-private.pem -pubout -out dc-public.pem
```
Put the private key in the backend env (single line, `\n`-escaped):
```sh
DOMAIN_CONNECT_PRIVATE_KEY="$(awk 'BEGIN{ORS="\\n"}1' dc-private.pem)"
```

### 2. Publish the public key as a TXT record
Publish the public key at `_dcpubkeyv1.seedeez.com` (= `syncPubKeyDomain` in the
template). The DNS provider fetches it to verify our signature. Exact TXT value
format is per the Domain Connect signing spec — validate with the official
`domain-connect` SDK / online editor before relying on it; the `key` query param
the backend sends must resolve to this record.

> ⚠️ The precise `sig`/`key` encoding can differ slightly per provider. Test the
> signed apply URL against GoDaddy's `coolexample.com` demo (or the online editor)
> and adjust `buildApplyUrl` in `src/lib/domain-connect.ts` if needed before go-live.

### 3. Test the template
Online editor: https://domainconnect.paulonet.eu/dc/free/templateedit
Paste `seedeez.com.blog.json`, set `subdomain=blog`, confirm it renders the CNAME.

### 4. Submit + onboard per provider
1. PR the template to https://github.com/Domain-Connect/Templates as
   `seedeez.com.blog.json` (filename = `providerId.serviceId.json`).
2. **GoDaddy** — email `domainconnect@godaddy.com` to onboard. Human process,
   has lead time — start early.
3. **Cloudflare** — follow https://developers.cloudflare.com/dns/reference/domain-connect

### 5. Flip on each provider in code
Once a provider confirms onboarding, add its `providerId` to
`ONBOARDED_PROVIDER_IDS` in `src/lib/domain-connect.ts`
(`godaddy.com`, `cloudflare.com`). Until then those domains correctly fall back
to the Tier 2 manual CNAME flow.

## Template fields
| Field | Meaning |
|---|---|
| `providerId` / `serviceId` | Identify us + this service; filename is `providerId.serviceId.json` |
| `%subdomain%` | Open variable — the label the customer picked (default `blog`) |
| `pointsTo` | Our Cloudflare for SaaS fallback origin |
| `syncPubKeyDomain` | Where our public key TXT lives (signature verification) |
| `syncRedirectDomain` | Domains allowed as `redirect_uri` after authorize |
| `warnPhishing` | Provider shows an anti-phishing notice |
| `version` | Bump on every template change |
