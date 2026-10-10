# Deployment guide and release gates

## Supported architecture

Browser → trusted OpenAI Sites authentication/access gateway → vinext Worker →
Cloudflare D1. The gateway owns `/signin-with-chatgpt`, `/signout-with-chatgpt`,
`/callback`, OAuth cookies, and verified identity-header injection. The app owns
its explicit owner/invitation authorization. Sign in with ChatGPT establishes
identity, not workspace membership. Use the hosting platform's access policy
and this app's invitation grants as appropriate.

This repository cannot verify or provision the Sites control plane for you.
Availability, deployment commands, project permissions, gateway header stripping,
origin restrictions, and runtime secret injection are deployment-specific.
No speculative OpenAI deploy CLI or one-click unauthenticated Cloudflare recipe
is provided. A generic `wrangler deploy` is **not** a safe deployment path for
this unmodified app. See `SECURITY.md` for the forged-header threat.

## Prepare a fresh deployment

1. Provision your own Sites project and **new** D1 database through your
   authorized control-plane workflow. Keep the binding name `DB`; the app uses
   that exact binding. Replace the obvious `project_id` placeholder in
   `.openai/hosting.json` with your own ID outside the generic public template.
2. Have the control plane inject the real D1 resource and production runtime
   environment. `vite.config.ts` uses a local placeholder database UUID only.
   It is not a remote deployment database configuration. R2 is unused.
3. Supply `OWNER_EMAIL`, an optional neutral/public owner label, a random
   32-byte base64url `INVITE_CODE_SECRET`, your positive integer total and
   installment in cents, and your valid anchor date. Set `SITE_URL` to the real
   canonical HTTPS origin. Never inject secrets into frontend `VITE_` or
   `NEXT_PUBLIC_` values. Leave `EASTER_EGG_ENABLED=false` unless you explicitly
   opt into the bundled noncommercial media.
4. Apply `drizzle/0000_initial_schema.sql` to the new database through the
   platform's migration mechanism. `npm run build` includes it and its clean
   journal under `dist/.openai/drizzle/`; `build/sites-vite-plugin.ts` packages
   metadata and migrations, but does not create a project, run SQL remotely,
   grant access, or deploy. Drizzle snapshots/legacy upgrade data are not
   included. Runtime table initialization exists as a convenience, not as a
   legacy database upgrade strategy.
5. Confirm the gateway strips client-provided `oai-authenticated-user-*`
   headers, injects only verified values, protects reserved auth paths, and
   blocks direct Worker-origin access (including alternate domains).
   Merely setting `OWNER_EMAIL` is insufficient.
6. Review dependency advisories and licensing. Run `npm ci`, lint, typecheck,
   tests, and build. Deploy the exact reviewed artifact through your authorized
   Sites workflow. Production authentication checks require the real gateway;
   unit tests cannot certify it.

This initial schema is deliberately reset. It is for a fresh fork, not an
upgrade over an existing deployment. Do not point a public-release clone at an
old personal ledger or try to apply the initial migration over existing tables.
Back up and review any separate upgrade/data-conversion plan first.

## Local database inspection / migration check

The development server uses local Miniflare/D1 state under `.wrangler/`. Routes
initialize the schema on first use. To exercise the clean migration explicitly,
use a separate empty local persist directory, not the dev database that already
contains tables:

```bash
npm run build
npx wrangler d1 execute DB --local   --config dist/server/wrangler.json   --persist-to .wrangler/schema-check   --file drizzle/0000_initial_schema.sql
```

This command is local only. The generated configuration exists after building;
it contains placeholder resources and empty vars. Do not mistake it for an
approved production configuration. No `--remote` command is needed for local
checks. Generated configuration/migrations are not committed. For schema
changes, maintain reviewed SQL and the schema together; this repository does
not have a configured Drizzle generation CLI.

## Acceptance checks at the real gateway

- Anonymous: invitation screen, payment API 401, media 404; no ledger exposure.
- Signed in but no grant: invitation-only gate; payment/media authorization
  denied. Redeem a valid invitation to gain the intended access.
- Owner: can issue/revoke invitations and manage payments. Invited users create
  pending entries but cannot approve/edit/delete other records.
- Blank or invalid financial configuration: authorized GET reports zero totals
  and `configured:false`; all payment mutation methods return 503. The UI shows
  Configuration required, not Paid in full, and progress has no NaN/Infinity.
- Configured synthetic schedule: correct next installment, partial credits,
  approved total cap, approval workflow, and edit/delete recalculation. Use a
  disposable test database, never real records as fixtures.
- Forged identity header sent by a browser/client: gateway removes/ignores it;
  never becomes the configured owner's verified identity. An unauthenticated
  request must not gain access by supplying that header.
- Direct origin/alternate host: unreachable or denies unauthenticated traffic
  independently of user-supplied headers. This is a mandatory external gate.
- Cross-origin mutations: 403. Private responses remain no-store through the
  gateway/CDN. Static preview is neutral; old public media paths are absent.
- Easter egg disabled: media endpoints 404, no image/audio requests. Enabled:
  only owner/active invitees receive media. Review browser audio and reduced
  motion behavior with your chosen replacement media.

## Operations and rollback

Keep secrets and real runtime configuration outside Git. Encrypt and control
D1 backups, limit administrator access, and decide payment retention/deletion
policy. A code rollback does not roll back database changes or restore a rotated
invitation key. Revoke stale grants and expired/revealed codes. Changing owner
email changes authorization; historical submitted/approved emails remain in
records until handled by a separate reviewed data policy. Decreasing the total
below existing approved credit is not a supported ledger correction: review and
correct the records/configuration deliberately.

Store reviewed build/version receipts without private data. CI does not deploy,
commit, publish, create Cloudflare resources, or use production secrets. No
live gateway or cloud deployment is claimed verified by this release's local
checks. Resolve those independent gates before claiming production readiness.
