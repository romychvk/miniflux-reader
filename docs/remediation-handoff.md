# Miniflux Reader — Remediation Handoff

_Last updated: 2026-07-18_

Continuation doc for the security/perf remediation driven by [`audit-2026-07-17.md`](./audit-2026-07-17.md).
**All three stages are done and deployed** (Stage 1 blocking risks, Stage 2 stability, Stage 3
perf & maintainability). The remediation is complete; this doc is the historical record.

## How this project ships

- **Deploy = `git push origin main`** → GitHub webhook → Dokploy auto-rebuilds → https://miniflux-reader.romych.pp.ua.
  A code-only push is a normal rebuild; a `docker-compose.yml` change forces a container recreate.
  A Dokploy "Deploy" with **no new commit is a no-op** (won't restart).
- **`ALLOWED_MINIFLUX_SERVER=https://miniflux.zina.run`** is set in Dokploy → Environment Settings **and**
  wired into the container via `docker-compose.yml` `environment:` (Dokploy Compose's env tab is
  `.env`-interpolation only, so the explicit `environment:` line is required or the var never reaches
  the container). It pins every server-side fetch to the real Miniflux. Don't remove it.
- **Local dev:** `npm run dev` (localhost:5173). **Never Docker locally.**

## Verification pattern (used for every change so far — keep it up)

1. `pnpm build` must pass. **The deploy gate is now `pnpm run check && pnpm test && vite build`** (check added
   2026-07-18, tests added 2026-07-19 `9b23529`) — a type error OR a failing unit test now fails the build, so
   keep both `check` (0 errors) and `pnpm test` (all pass) green.
2. `pnpm check` — **baseline is now 0 errors / 39 warnings. Keep errors at 0.**
   The 39 warnings are benign Tailwind `@reference`/`@apply` noise (EntryContent.svelte + TopBar.svelte).
3. Pure modules → a throwaway `node --experimental-strip-types test.mts` unit test (see how `safeFetch`
   and `embedHosts` were tested). Note: **no TS parameter-properties** in code that this must run (strip-only mode chokes).
4. Server behavior → prod-style smoke: `PORT=5199 node build` (add `ALLOWED_MINIFLUX_SERVER=...` to test the pin) + `curl`.
5. Anything that renders → **the user browser-tests it** before commit.
6. After push → poll prod for the change to land (each change has an externally-observable signal).

## Stage 1 — DONE & deployed (do not redo)

| Area | What shipped |
|---|---|
| Headers | `src/hooks.server.ts`: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy`; `Cache-Control: no-store` on `/api/settings`,`/api/proxy`,`/api/ai` |
| Tooling | `svelte-check` + `@types/node` + `check` script |
| Lifecycle | `(app)/+layout.svelte` onMount made sync (+ `boot()`) so matchMedia cleanup registers |
| Scroll | auto-mark-read now uses observer geometry (exit-via-top); deleted `src/lib/scroll.ts` |
| Auth-gate | `src/lib/server/minifluxAuth.ts` `requireMinifluxAuth` on fetch-page/og-image/rss-bridge; client `authedFetch` in `$lib/api.ts` on all 8 call sites |
| SSRF+DoS | `src/lib/server/safeFetch.ts` (DNS-resolve + `ipaddr.js` private-range blocklist v4/v6 + per-hop redirect validation + rebinding-closing lookup + timeout + streaming byte cap) on the 3 arbitrary-URL endpoints |
| XSS | `src/lib/sanitize.ts` + `src/lib/embedHosts.ts`: DOMPurify before every `{@html}`; iframe host-allowlist; forbids object/embed/form/`<style>` |
| Proxy | `/api/proxy` pinned via `isAllowedMinifluxServer()` (403 on mismatch) + 60s timeout |

## Gotchas — read before touching related code

- **CSP goes in `svelte.config` `kit.csp`, NOT `hooks.server.ts`** — a hand-rolled CSP breaks SvelteKit's
  hashed inline hydration script. `frame-src` must allow the embed hosts in `src/lib/embedHosts.ts`.
- **Do not set an aggressive `Referrer-Policy`, and keep `referrerpolicy` OFF images** — the app relies on
  document-wide `<meta name="referrer" content="no-referrer">` for hotlink-protected feed images. The sanitizer
  re-adds `referrerpolicy="strict-origin-when-cross-origin"` on **iframes only** (fixes YouTube "error 153").
- **Miniflux path (`/api/proxy`, `/v1/me`) is protected by the PIN, not the safeFetch blocklist** — a
  self-hosted Miniflux may legitimately be on a private address.
- **`src/lib/stores/entries.svelte.ts` contains a null byte → ripgrep treats it as binary and silently skips it.**
  Read/grep it directly; don't trust a repo-wide search to have covered it.

## Stage 2 — stability (START HERE)

1. ~~**Fix the 16 `svelte-check` errors, then make `check` a deploy gate.**~~ **DONE & deployed 2026-07-18**
   (4 commits `3a4118f`→`fbb4707`, one concern each). `pnpm check` now **0 errors / 39 warnings**
   (the 39 are the benign Tailwind `@reference`/`@apply` noise). What shipped:
   - **Route params (4):** `src/lib/slug.ts` `parseFeedSlugId`/`parseEntrySlugId` now take `string | undefined`
     (`slug?.match(...)`); undefined→null, which all 4 `+page.svelte` call sites already handle. Unit-tested 11/11 via strip-types.
   - **Icon types (7):** `ContextMenu.svelte` `MenuItem.icon` was `Component<{size:number}>`, but lucide-svelte
     0.474 icons are Svelte-4 **class** components → retyped as `typeof Icon` (imported the base `Icon` **value**
     from `lucide-svelte`; used only in `typeof`, so it tree-shakes). One fix covers EntryRow/FeedItem/FeedTree/TopBar.
     NOTE: `ComponentType<Icon>` also works but is **deprecated** in Svelte 5 and adds 2 warnings — don't use it.
   - **`scroller` nullable (5):** `FeedSettings.svelte` scroll-spy — the nested `update()` closure re-widened the
     guarded `scroller`; bind the guarded value to a fresh `const scroller = scrollerEl` so the closure sees non-null.
   - **Deploy gate:** `package.json` `"build": "pnpm run check && vite build"`. Dokploy's Dockerfile installs devDeps
     and runs `pnpm run build`, so a type regression now fails the prod image build (`&&` short-circuit). Locally
     testable via `pnpm build`; DRY (reuses `check`). Chose this over a Dockerfile `RUN` or a pre-push hook because
     it's enforced everywhere `build` runs and needs no Docker to test. **First gated Dokploy build = fbb4707.**
2. ~~**Abort/generation guards** for `$effect`-driven data loaders~~ **DONE & deployed 2026-07-18** (commit `dcc6a94`).
   Survey result: only `article/[slug]/+page.svelte` was unguarded (raw `apiCall(...).then(entry=...)`). Every other
   route effect (All/starred/category/feed) delegates to `entries.loadEntries`, which was **already** abort-guarded
   (it *is* the centralized abortable loader — aborts the prior `AbortController`, ignores `AbortError`, clears
   `loading` only when `!signal.aborted`); `feed/…/settings` does only sync `ui.selectFeed`. Fix: article effect now
   builds an `AbortController`, passes `signal` to `apiCall` (forwarded to `fetch`), ignores `AbortError`, gates the
   `finally` on `!signal.aborted`, and returns `() => controller.abort()` as cleanup — mirrors the `loadEntries` idiom.
   (Cleanup calls `abort()` on a per-run `const`, so it dodges the Svelte-5 teardown-stale-state trap.)
3. ~~**Unique settings temp file per write**~~ **DONE, deployed 2026-07-18** (commit `1d38412`). `settings/+server.ts`
   PUT now writes `${filePath}.${randomUUID()}.tmp` (was shared `${filePath}.tmp`) + atomic rename + best-effort
   `unlink` on failure. Kills the shared-temp interleave when an unload flush races the boot push (see
   settings-sync memory). Verified: check 0 errors, gated build, a node fs-concurrency test (1600 concurrent
   writes → 0 corrupt / 0 temp-leak), and a boot smoke (route 400s on missing headers). **Write path itself not
   pre-commit browser-tested — user deployed to verify the save→reload persistence on prod.**
4. ~~**Hash the authCache key**~~ **DONE, deployed 2026-07-18** (commit `deb6741`). New shared `src/lib/server/authCache.ts`
   (`createAuthCache(ttlMs)` + `hashAuthKey`): `Map` key is now SHA-256 of `${server}|${token}` (no raw tokens in memory;
   token is high-entropy so plain SHA-256 suffices — no HMAC/salt), and `set()` prunes expired entries every write (size cap
   is just a burst backstop). Both `minifluxAuth.ts` and `settings/+server.ts` dropped their raw-key `Map` and use it.
   Unit-tested 19/19 (strip-types); boot-smoked (settings 400, fetch-page 401, proxy 400). Server-only → no browser test.

**✅ STAGE 2 COMPLETE.** All four items + the login-hardening bonus shipped and deployed. Next up is Stage 3 (below).

**Login hardening — DONE, deployed 2026-07-18** (commits `9a2dba4`, `9c4af3e`; not a numbered item — came out of a prod
incident). User entered `https://miniflux.zina.run/v1/` in a fresh (guest) login; the app sent that whole string as
`X-Miniflux-Server`, the proxy pin does an **exact** match against `ALLOWED_MINIFLUX_SERVER=https://miniflux.zina.run`,
so every proxy call 403'd → empty shell + "Server not allowed (categories)". Not a code regression (settings-sync
never touches `miniflux_server` — `isSyncableKey` excludes it). Fix: new pure `src/lib/serverUrl.ts`
`normalizeServerUrl()` collapses any entered URL to its **origin** (drops `/v1/` path, trailing slash, query/hash,
whitespace; assumes https; throws on garbage) — used by `auth.login()` (with a safe fallback) and the login page.
Login page now also **validates** server+token via `/api/proxy/me` before persisting, with status-specific errors
(403 = pin, 401 = bad token, 502 = unreachable) + a disabled/"Logging in…" button — so a bad URL no longer strands
you in a logged-in-but-everything-403s shell. `normalizeServerUrl` unit-tested 12/12 (strip-types).

(Stage 2's lifecycle-cleanup and scroll-tracking items already shipped in the quick-wins PR.)

## Optional — finish XSS defense-in-depth

**Strict CSP via `kit.csp` — DONE & deployed 2026-07-18** (commit `1aeab1b`; header confirmed live on
prod ~75s after push). Defense-in-depth on top of the DOMPurify sanitizer (which remains the primary XSS
control — CSP is not a replacement). Two files: `svelte.config.js` (`kit.csp`) + `src/app.html` (nonce on
the anti-FOUC theme script). Key decisions:
- **`mode: 'nonce'`** (not hash): SvelteKit stamps a per-request nonce on its own bootstrap script AND on
  the app.html theme script via `nonce="%sveltekit.nonce%"` — no brittle hardcoded hash to maintain. Safe
  because nothing is prerendered (`(app)` is `ssr=false`, every page is dynamically rendered). Verified:
  both inline scripts carry the same nonce as the header, and it differs per request.
- **`script-src 'self'` with NO `unsafe-inline`** — the actual XSS lock. SvelteKit adds the nonce.
- **Styles:** `style-src 'self'` + a SEPARATE `style-src-attr 'unsafe-inline'`. Inline `style=""` attrs are
  everywhere (feed articles + several Svelte components), but SvelteKit adds the nonce to `style-src`, and a
  nonce there would cancel `unsafe-inline` — so inline attrs get their own directive SvelteKit doesn't touch.
  `<style>` elements stay blocked (none exist at runtime: no Svelte transitions — the app uses the native CSS
  View-Transitions API, external CSS — and DOMPurify forbids `<style>` in articles).
- **`frame-src`** built from a local `EMBED_HOSTS` mirror in `svelte.config.js` (`https://{h}` + `https://*.{h}`
  per host = the sanitizer's apex-or-subdomain rule). Can't import `src/lib/embedHosts.ts` there — the config
  loader may not strip `.ts` (Docker base can be < 22.18) — so it's a deliberate small dup with a sync comment.
- **`img-src`/`media-src`** permissive (`data: blob: https: http:`) — article/OG images hotlink from anywhere.
- **Enforced in production only.** Gated `process.env.NODE_ENV === 'development'` → off in dev (fail-safe: only
  an explicit `development`, which `vite dev` always sets, disables it; a build with NODE_ENV unset still gets
  the policy). Verified: `vite dev` serves NO CSP header, so HMR is untouched. **Test CSP against a prod build**
  (`pnpm build` then `node build`), never `npm run dev`.
- User browser-tested the prod build (hydration, all embed types, feed/article/OG images, inline styles, no
  FOUC) before commit; header then confirmed live on the real domain.

**Docker hardening — DONE & deployed 2026-07-19** (commit `d821d41`; validated on prod). Addresses audit §P2
Docker. `Dockerfile` restructured to 4 stages + a new `docker-entrypoint.sh`; `docker-compose.yml` unchanged.
- **Non-root at runtime.** No `USER` line in the Dockerfile; instead `ENTRYPOINT` runs `docker-entrypoint.sh`
  which starts as root, `chown -R node:node /app/data`, then `exec su-exec node "$@"` → PID 1 (`node build`)
  runs as **node (uid 1000)**. Root is used only for the startup chown. Verified on prod: `docker top` and
  `/proc/1/status` both show the app process at uid 1000.
- **Why the chown-then-drop entrypoint (not a plain `USER node`):** the existing prod named volume
  `settings-data` was created while the container ran as root, so its files/dir were root-owned. A plain
  `USER node` couldn't write there → settings save would break. The entrypoint fixes ownership on every start
  (idempotent), covering both the pre-existing root-owned volume and a fresh one. The Dockerfile also
  `mkdir -p /app/data && chown node:node` so a *fresh* volume inherits node ownership.
- **⚠️ GOTCHA — don't "verify non-root" with `docker exec … id`.** `docker exec` (and Dokploy's "enter
  container") starts a NEW process as the image's configured USER — which is root here (no `USER` line) — so
  `id` shows **root** regardless of what PID 1 runs as. It measures the exec session, not the app. Check PID 1
  instead: `docker top <container>` or `docker exec <c> cat /proc/1/status | grep Uid` (expect `Uid: 1000 …`).
  Corroborating signal: files the app writes into `/app/data` after startup are **node-owned** (writeFile+rename
  preserves the writer's uid) — if the app were root, they'd be root-owned.
- **⚠️ Do NOT add `user: "1000:1000"` to the compose service** — it would stop the entrypoint from running as
  root, so the volume `chown` and `su-exec` would fail. Privilege drop is the entrypoint's job.
- **Prod-only deps.** A dedicated `prod-deps` stage (`pnpm install --prod --frozen-lockfile`) supplies the
  runtime `node_modules` (was: the full dev tree copied from the build stage). Verified locally the app boots
  and serves with only `dompurify/ipaddr.js/lucide-svelte` (+ transitive) — every devDep is build-time.
- **Pinned base.** `node:22.23.1-alpine@sha256:16e22a55…` (via a global `ARG NODE_IMAGE`, reused by all
  stages) for reproducible builds. 22.23.1 ≥ 22.18 → also satisfies the prerequisite for gating `build` on
  `pnpm test` (Stage 3 item 6). Bump the version AND digest together; a pinned digest won't auto-pull patches.
- **Validation was deploy-then-verify** (no Docker locally): local prod-deps boot smoke + `sh -n` on the
  entrypoint pre-commit; then a watched Dokploy deploy (Monitor showed a steady 200 with no crash-loop) + a
  prod save→reload / container inspection. Rollback was ready (`git revert d821d41` + push).

## Stage 3 — perf & maintainability — DONE & deployed 2026-07-18

All six items shipped (10 commits `bebc08d`→`ad1897a`, one concern each). `pnpm check` stays
**0 errors / 39 warnings** and `pnpm build` (the gate) is green throughout. Each change proved
equivalence (same output before/after), not just that it compiles.

1. **One DOM parse per entry** (`bebc08d`). `enrichEntries` parsed each article 2–3× (separate
   `DOMParser` passes in thumbnail / description / date extraction, ~200–300 on a 100-entry page).
   Now it parses the decoded content once and shares the `Document`. The only mutating reader
   (`extractDescription` inserts spacing nodes) runs **last**, after the read-only thumbnail/date
   extraction, so behaviour is identical. Applied in both `enrichEntries` and `fetchAndStore`.
   Representative page: 210 → 100 parses (2.1×).
2. **One shared `IntersectionObserver`** (`f6aa12d`). `EntryRow` created one observer per row
   (~100 on a full page). New `src/lib/autoMarkRead.ts` holds a single observer; rows register via
   `use:autoMarkRead={entry}`. The exit-via-top geometry is verbatim. GOTCHA: keyed rows are reused
   across list reloads with a **fresh entry object of the same id**, so the action's `update` hook
   refreshes the tracked reference (the per-row closure got this free via reactive props). Observer
   is torn down when the list empties so it re-roots cleanly.
3. **Batched OG-cache write** (`f715866`). `ensureThumbnail` wrote the whole cache to localStorage
   after **every** resolved image. Now a trailing-throttle (`scheduleOgCacheFlush`, 500ms) coalesces
   the burst + flushes on `pagehide`/`visibilitychange:hidden`. The thumbnail is still assigned
   synchronously (UI unchanged); only the persistence write is deferred. `ogImages*` is a
   regenerable cache and **not synced** (`isSyncableKey` excludes it), so a lost trailing batch on a
   hard kill just re-resolves next session. 25-cover page: 25 → 1 write.
4. **Bounded fan-out** (`3ff2b99`). `loadIcons` (`Promise.allSettled`) and `refreshCategoryFeeds`
   (`Promise.all`) fired one request per feed at once. New `mapPool(items, limit, task)` worker-pool
   caps both at 6 (audited 4–8 band). Same set of requests, each run once; tasks still swallow their
   own errors. Later moved to `$lib/pool.ts` in 5b.
5. **Module decomposition:**
   - **5a** (`a508081`): the pure enrichment cluster (~150 lines) → `src/lib/enrichment.ts`
     (`decodeContent`, `parseContent`, `extractDescription`, `pickThumbnail`, `enrichEntries`,
     `loadCoverRule` + private helpers). Verbatim move; `entries.svelte.ts` 770 → 685. NOTE: the
     store **keeps its lone null byte** (the cache-key separator in `ensureThumbnail`, `` `${url}\0${sig}` ``),
     so it stays ripgrep-invisible; `enrichment.ts` has none and IS searchable.
   - **5b** (`67ebadc`, `9f94731`): `mapPool` → `$lib/pool.ts` (also DRYs `refetchFeedLatest`);
     the sidebar order read/write pair → `$lib/feedOrder.ts` (`persistOrder` now takes the tree as
     an arg instead of closing over the store's `feedTree`). `feeds.svelte.ts` 496 → ~430.
   - **5c** (`fcd4b32`, `23ba5fd`): a **UX change + split** the user asked for. Phase 1 — show one
     settings section at a time (nav click sets `activeSection`; sections hidden via `class:hidden`
     so they stay **mounted** and field/AI-assistant state survives switching); scroll-spy removed;
     nav made mobile-usable (horizontal tabs); save bar de-chromed and moved directly below the
     active section. Phase 2 — extract all six sections into `content/feed-settings/*`. All form
     state + `dirty`/`computeChanges`/`persistChanges` **stay in the parent**, passed down as
     `$bindable()` props (+ `onRefetch`/`onApplyAiRules` callbacks), so one Save persists every
     section; `rssSourceUrl` binds into **both** General and RSS-Bridge (single source of truth).
     `FeedSettings.svelte` 785 → 404.
6. **Tests** (`ad1897a`). Was zero. `node:test` unit tests run natively as TS on Node (`pnpm test`,
   **19 pass**): `contentFilter`, `filterHide` (block/keep hide matching = the mark-read decision),
   `dedup`, `settingsBackup` (`isSyncableKey` — secrets/caches never sync). Proxy SSRF/auth/method
   reads `$env`, so it's an **integration smoke** (`pnpm test:proxy`, boots `node build` with the pin
   → 400/403/502/405, **4 pass**). Infra: `tests/hooks.mjs`+`setup.mjs` (resolve hook so Node loads
   source modules with Vite-style extensionless imports) and `allowImportingTsExtensions` in tsconfig
   (keeps svelte-check happy with the `.ts` test imports). **Now gated into `build`** (2026-07-19, `9b23529`):
   `build` = `pnpm run check && pnpm test && vite build`, so a failing unit test aborts the prod image build.
   This became safe once the Docker base was pinned to `node:22.23.1-alpine` (≥ 22.18, so native TS stripping
   is default) — see the Docker hardening section above. Only the 4 pure `.test.ts` files run in the gate; the
   proxy smoke is `.mjs` (excluded from the glob) and needs a built server, so `test:proxy` stays a separate
   manual smoke. Verified the gate bites: a deliberately failing test aborts `pnpm build` before `vite build`.

**✅ REMEDIATION COMPLETE — including the optional defense-in-depth.** Both extras shipped: the strict CSP
via `kit.csp` (2026-07-18, `1aeab1b`) and the Docker hardening (2026-07-19, `d821d41`) — see the Optional
section above. Nothing outstanding from the audit except the P3 `cookie@0.6.0` advisory (low; the app sets no
cookies), pending a patched SvelteKit dependency tree.
