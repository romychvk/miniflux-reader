# Contributing

Thanks for your interest! A few ground rules keep the project easy to maintain:

## Setup

```bash
pnpm install
pnpm dev        # dev server on localhost:5173 (point it at your own Miniflux instance)
```

## Before opening a PR

```bash
pnpm check      # svelte-kit sync + svelte-check — must report 0 errors
pnpm test       # node:test suite — must be green
```

Both also run inside `pnpm build`, so a red check or test fails the build.

## Conventions

- **Tabs** for indentation in Svelte/TS files; no Prettier/ESLint is configured — match the
  surrounding style.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) — prefer `$derived` over `$effect` for
  computed values; stores are rune modules in `src/lib/stores/*.svelte.ts`.
- Keep components small and focused; pure logic goes into plain `.ts` modules so `node:test`
  can cover it (rune stores are not importable in tests).
- Errors surface to the user via `ui.showError()` — catch in store methods, not in components.
- New server endpoints that fetch on the caller's behalf must be gated by `requireMinifluxAuth`
  and use `safeFetch` for outbound requests (SSRF guard).

## Scope

The app is a thin client for [Miniflux](https://miniflux.app) — features that need server-side
state beyond the per-user settings blob are probably out of scope; open an issue first.
