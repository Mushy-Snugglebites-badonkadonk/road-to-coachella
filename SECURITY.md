# Security model and reporting

## Required trust boundary

This application accepts `oai-authenticated-user-email` as its identity input.
It does not cryptographically verify that header or implement OAuth itself.
`oai-authenticated-user-full-name` is optional display data; its companion
encoding header indicates percent-encoded UTF-8. A full name is never an
ownership credential. `OWNER_EMAIL` is compared to the injected email.

These headers are trustworthy **only behind the trusted OpenAI Sites gateway**
that authenticates the user, removes all client-supplied identity headers,
injects its verified identity, and prevents direct access to the application
Worker origin. Gateway configuration and origin isolation are prerequisites,
not properties this repository can establish from inside a request handler.

**Do not deploy this unchanged application to an unauthenticated public
`workers.dev` URL, arbitrary Cloudflare custom domain, or a generic server.**
An attacker who can reach it directly can forge the identity header, impersonate
the configured owner, read data/media, and mutate records. Same-origin checks,
CSP, invitation codes, noindex directives, and a secret invitation encryption
key do not repair that authentication failure. A local curl test with a forged
synthetic owner header succeeding is expected; it is not evidence of safe
Internet deployment.

For independent self-hosting, design and review a separate verified identity
layer and strip forged headers at every ingress while blocking bypass origins.
Simply forwarding identity-looking headers is not that layer. This release does
not supply such an authentication system or claim self-hosting security.

## Existing defenses and limits

- Anonymous payment requests return 401; nonowners need active D1 access grants.
  Owner-only mutation checks are enforced on the server, not just hidden in UI.
- Mutations require exact same-origin Origin or same-origin fetch metadata.
  This reduces browser CSRF; it does not authenticate arbitrary HTTP clients.
- Payment amounts and real calendar dates are validated; SQL is parameterized.
  Approved total limits and the current payment status are checked within one
  mutation SQL statement, including edits racing with approvals.
- Invitation claims recheck active status and expiry inside an atomic D1 batch.
  The grant requires `changes() = 1` from the immediately preceding claim and
  matching redeemed identity; a lost claim cannot insert/reactivate a grant.
  Revocation atomically marks the invitation revoked and disables its grants.
- Invitations use cryptographically random codes, SHA-256 lookup hashes, and
  AES-GCM encryption with an operator-provided 32-byte key. Redemption attempts
  are limited per identity. Lost/rotated keys can make old codes unreadable;
  do not casually rotate without a reviewed revocation/migration plan.
- Financial settings default to zero/blank. All payment mutations are blocked
  with 503 while the schedule is unconfigured. This is a correctness gate,
  not a replacement for authentication.
- Media is disabled by default. When enabled, authorized routes return private,
  no-store responses and same-origin resource policy; unauthorized requests
  receive 404. No media resides at public static JPEG/audio URLs.
- Private JSON/HTML is marked no-store; responses include CSP, no-referrer,
  anti-framing, nosniff, permissions-policy, and crawler exclusion. CSP still
  allows inline scripts/styles for the framework and is not a strict nonce CSP.
  The deployed gateway/CDN must preserve these headers and avoid shared caching.
- `SITE_URL` is explicit configuration, not a value derived from untrusted Host
  or forwarded headers. It is not an access-control setting.
- Invitees share aggregate progress and approved amounts/payment dates, with row
  IDs/status for chart clients. Other participants' identifiers, notes, and
  approval/creation timestamps are redacted in the shared approved ledger.
  Each participant can read their own submissions; only the owner sees the full
  participant/audit ledger. Amount/date patterns can still reveal activity;
  invitation access is not a promise of anonymous aggregate statistics.
- Emails, names, notes, and payment records are personal data stored in D1.
  Establish retention, access reviews, backup protection, and deletion practices.
  This tracker is not a financial institution or payment processor.

## Public-source privacy and licensing

The clean release contains no personal financial seed/migration history,
production project IDs, real owner email, or original deployment hostname.
The raw easter-egg image/audio is deliberately included with permission.
Authorized HTTP access does not make files in a public repository confidential,
and generic filenames do not anonymize a face/voice. Review all retained media
before redistributing it. `ASSET-LICENSE.md` describes the separate CC BY-NC
license and noncommercial limitations; no new ownership claim is made here.

Do not commit `.env*`, `.dev.vars*`, invitation secrets, D1 exports, local
`.wrangler` state, generated bundles, logs, or `node_modules`. Build-time vars
are intentionally empty even if local `.env` contains secrets.

## Dependency advisories

The inherited full dependency graph initially reported 28 affected packages,
including a critical Next.js report. Compatible verified updates now clear all
critical/moderate findings and the fixable runtime leaves: Next.js 16.3.8,
matched React/React DOM/RSC 19.2.8, patched image-size, sharp, fast-uri, PostCSS,
and the Cloudflare toolchain. The current full audit reports **8 high affected
packages propagated from one unresolved braces 3.0.3 advisory**; the production
manifest-only audit reports zero. The remaining dependency is used by ESLint
root-directory globbing and Vite build-time dynamic-import transforms, not by
an application payment/media handler. This is a reachability assessment, not
proof of total non-exploitability or a waiver. See `DEPENDENCIES.md` for chains,
registry evidence, and restrictions.

The registry's latest braces release remains affected; npm's offered remedy is
a framework/linter downgrade, not a patched leaf. No unreviewed parser patch or
breaking downgrade is hidden in this release. Do not run build/lint against
untrusted source/glob input or expose dev tooling. Independently review this
residual before deployment; maintainers must decide acceptance or await an
upstream fix. Re-run the complete `npm audit` before every release and do not
substitute passing lint/tests/build for dependency security review.

## Reporting

Report vulnerabilities privately through the repository host's security
advisory mechanism if enabled, or an established private maintainer channel.
No dedicated monitored disclosure email is claimed by this project. Do not
publish live emails, invitation codes, keys, payment records, or private gateway
information in public issues. For ordinary bugs, use synthetic fixtures and
state your Node/toolchain versions. No response-time SLA is promised.
