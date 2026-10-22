# Dependency remediation and residual advisory

The dependency updates in this release were resolved from the official npm
registry, installed using a standard clean `npm ci`, and exercised by lint,
TypeScript checks, tests, and a real vinext build. The lockfile contains actual
registry tarball URLs/integrity values, not handwritten guessed checksums.
Node 22.22.3 remains the verified toolchain. No `npm audit fix --force`, linter
downgrade, or vinext major migration was used.

## Compatible fixes

| Dependency / family | Reviewed installed version |
| --- | --- |
| Next.js + Next ESLint config/plugin | 16.4.2 |
| Vite | 8.1.6 (exact pin) |
| React, React DOM, react-server-dom-webpack | matched 19.2.8 |
| Cloudflare Vite plugin | 1.63.1 |
| Wrangler | 4.149.0 |
| Workers types | 5.20261006.1 |
| image-size (vinext runtime transitive override) | 2.0.4 |
| fast-uri (3.x override) | 3.1.8 |
| PostCSS (8.x override) | 8.5.29 |
| sharp (0.35 patch override) | 0.35.5 |
| undici (Cloudflare transitive) | 7.29.1 |
| js-yaml (4.x-only override) | 4.3.2 |
| brace-expansion (separate 1.x / 5.x overrides) | 1.1.21 / 5.0.12 |
| source-map-js | 1.2.2 |
| fflate (0.7 patch) | 0.7.5 |
| nanoid (3.x patch) | 3.3.20 |
| baseline-browser-mapping / browserslist | 2.11.28 / 4.29.3 |

Native platform packages and the Cloudflare workerd/Miniflare/esbuild closure
were updated as required by these versions. Miniflare is 5.20261006.1-alpha,
the version selected by the official Cloudflare Vite plugin, not a handwritten
major substitution. vinext remains 0.0.50: its vulnerable image-size leaf was
patched through a compatible 2.x override without a framework major update.
Published vinext 1.1.0 still depends on vite-plugin-commonjs ^0.10.4 and therefore
would not eliminate the remaining glob-parser chain merely by upgrading.

## Narrow follow-up verified 2026-10-22

New Next.js and Vite advisories appeared after the earlier remediation. The
follow-up updates only Next.js and its matched ESLint configuration/plugin to
16.4.2, the required matched Next.js environment/SWC packages, and Vite to
8.1.6. Vite is now pinned exactly instead of using a caret range. The lockfile
delta contains 13 package records plus the root manifest record; all unrelated
resolved packages, existing overrides, React/RSC versions, vinext, Cloudflare
tooling, application code, and tests remain unchanged.

The candidate passed a clean-install dry run, a real standard `npm ci`, lint,
TypeScript, all 32 tests, a production build, and 29 local runtime assertions
covering unconfigured/configured operation, authorization, mutation limits,
same-origin enforcement, and disabled/enabled private media. Runtime smoke used
synthetic data and loopback-only development/Worker instances; it is not live
deployment, public gateway authentication, or production-origin validation.

## Audit result as of 2026-10-22

- Historical original full graph: **28 affected packages** (1 critical, 22 high,
  5 moderate).
- Immediately before this follow-up: **10 affected package entries** (1 critical,
  9 high), including newly reported Next.js/Vite findings.
- After the follow-up: **8 affected package entries**, all high; 0 critical,
  0 moderate. All scoped Next.js and Vite advisory IDs are absent.
- `npm audit --omit=dev`: **0 affected packages** after this follow-up, versus
  one critical affected package immediately before it.

The complete-graph audit is the authoritative residual disclosure. An
`--omit=dev` audit alone is not an audit of a bundled Worker: development-declared
framework dependencies can contribute runtime code. The fixed RSC and image
leaves were checked in the full graph too.

## Unresolved leaf: braces 3.0.3

Advisory: **GHSA-vfj7-8cjw-p6xm** — stack-exhaustion denial of service through
deeply nested patterns; affected range `<=3.0.3`.

https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

The official registry's latest `braces` version on 2026-10-22 was still 3.0.3.
The eight package-level reports are one leaf plus propagated parents:

- braces
- micromatch
- fast-glob
- @next/eslint-plugin-next
- eslint-config-next
- vite-plugin-dynamic-import
- vite-plugin-commonjs
- vinext

Installed paths:

```text
eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces
vinext → vite-plugin-commonjs → vite-plugin-dynamic-import → fast-glob → micromatch → braces
```

`@next/eslint-plugin-next/dist/utils/get-root-dirs.js` loads fast-glob for
project root discovery. `vite-plugin-dynamic-import/dist/index.js` loads it
for build-time dynamic import/glob transforms. These inputs come from project
configuration/source during lint/build/dev, not payment notes, API payloads,
invitation codes, or media requests. The generated Worker JS had no
`node_modules/braces` or `node_modules/micromatch` source markers in the local
build; that lexical observation supplements, but does not prove, reachability.

**Residual risk:** a malicious/deeply nested build/lint glob or untrusted source
can still cause toolchain denial of service. Keep development endpoints private
and do not lint/build untrusted source or accept arbitrary glob expressions.
Production handlers do not intentionally call this parser. Independent review
of the dependency delta does not accept this residual risk on behalf of a
maintainer: explicit acceptance or a verified fix is still required before
publication/deployment. The repository does not claim a clean full audit or
guaranteed non-exploitability.

npm's `fixAvailable` suggests downgrading ESLint config to 14.2.35 and vinext to
0.0.15. Those are not compatible patched parser releases and were deliberately
not applied. Await a real patched leaf/upstream closure, or review a separate
replacement/removal strategy; do not fabricate a fixes-only security claim.

## Recheck

```bash
npm ci
npm audit
npm audit --omit=dev
npm ls next react react-dom react-server-dom-webpack image-size fast-uri postcss sharp undici braces
npm run lint
npm run typecheck
npm test
npm run build
```

`npm audit` currently exits nonzero for the disclosed residual. CI checks
correctness/build reproducibility, not an undisclosed vulnerability waiver.
Security review, gateway verification, and publication remain separate human
release gates. Re-resolve/retest fixes as upstream advisories and versions change.
