# Miniflux Reader — Claude Code Guide

## Project overview

Miniflux Reader is a lightweight frontend for Miniflux RSS reader, built with SvelteKit + Svelte 5 + Tailwind 4.
It connects to a Miniflux instance via API token through a server-side proxy.

## Tech stack

- **SvelteKit** with `adapter-node`
- **Svelte 5** runes (`$state`, `$derived`, `$effect`, `$props`) in `.svelte.ts` modules
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin (no tailwind.config — use `app.css` with `@import "tailwindcss"`)
- **lucide-svelte** for icons
- **TypeScript** throughout

## Project structure

```
src/
  app.html, app.css, app.d.ts
  routes/
    +layout.svelte              # Base layout (imports app.css)
    +page.svelte                # Auth guard → App or redirect /login
    login/+page.svelte          # Login form (server URL + API token)
    api/proxy/[...path]/+server.ts  # Catch-all proxy → Miniflux API
  lib/
    types.ts                    # Shared interfaces
    api.ts                      # apiCall() fetch wrapper
    icons.ts                    # Canvas-based fallback feed icons
    time.ts                     # Relative timestamps
    stores/
      auth.svelte.ts            # Auth state (localStorage)
      feeds.svelte.ts           # Feed tree, counters, icons
      entries.svelte.ts         # Entry list, mark read, fetch content
      ui.svelte.ts              # UI state (selected feed, sidebar, errors)
      refresh.svelte.ts         # Manual refresh + background counter polling + "+N new" chip
    components/
      App.svelte                # Root shell: sidebar + topbar + content
      sidebar/                  # Sidebar, FeedTree, FeedItem
      topbar/                   # TopBar (hamburger + title + logout)
      content/                  # EntryList, EntryRow, EntryContent
      ui/                       # Spinner, Toast, RefreshIndicator
```

## Key patterns

- **Stores** use Svelte 5 runes in plain `.svelte.ts` files (not Svelte 4 `writable`/`readable`)
- **API proxy** at `/api/proxy/[...path]` forwards requests to Miniflux, reading `X-Auth-Token` and `X-Miniflux-Server` from request headers
- **Auth** is client-side only (localStorage), no SSR auth — page guard via `onMount`
- **IntersectionObserver** as a Svelte `use:` action for auto-mark-read on scroll-down
- **Feed icons** cached in localStorage under `favicons` key
- **`{@html content}`** for article rendering (content is sanitized by Miniflux)

## Commands

```bash
npm run dev       # Dev server on localhost:5173
npm run build     # Production build (outputs to build/)
npm run preview   # Preview production build
```

## Code conventions

- No Prettier/ESLint configured — use tabs for indentation in Svelte/TS files
- Keep components small and focused
- Prefer `$derived` over `$effect` for computed values
- Error handling: catch in store methods, display via `ui.showError()`
- No `client:only` directives — use `onMount` for browser-only code

## Miniflux API endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `feeds` | GET | List all feeds |
| `feeds/counters` | GET | Unread counts per feed |
| `feeds/{id}/icon` | GET | Feed favicon |
| `feeds/{id}/refresh` | PUT | Refresh one feed (synchronous crawl; fanned out with bounded concurrency for category/All refresh — the bulk `feeds/refresh` endpoint is async and is deliberately not used) |
| `feeds/{id}/entries?status=unread&order=published_at&direction=desc&limit=100` | GET | Feed entries |
| `entries?status=unread&order=published_at&direction=desc&limit=100` | GET | All unread entries |
| `entries/{id}/fetch-content` | GET | Re-scrape original article content |
| `entries/{id}` | PUT | Save re-scraped content for one entry |
| `entries` | PUT | Bulk mark read/unread |

## Deployment

**Production deploys automatically on push to `main`. No SSH or manual `docker compose` needed.**

The app is managed by **Dokploy** (a self-hosted PaaS) on the production host, deployed from
this GitHub repo via Dokploy's GitHub App integration with **auto-deploy enabled**:

```
git push origin main
   └─> GitHub webhook → Dokploy
        └─> Dokploy runs git pull + docker compose up -d --build
             └─> container is rebuilt and restarted automatically
```

- **Source**: GitHub `romychvk/miniflux-reader`, branch `main`
- **Build**: Dokploy builds from the `Dockerfile` (`build: .`, SvelteKit `adapter-node`)
- **Runtime**: container listens on port `3000` (internal `expose`, not published)
- **Routing**: Traefik reverse proxy → `https://miniflux-reader.romych.pp.ua`
  (Let's Encrypt TLS, http→https redirect)

**To deploy a change: just `git push origin main`** — that's the whole workflow.

### Do NOT edit infra files for deployment

- `docker-compose.yml` in this repo is the source compose, **but on the prod host Dokploy
  injects its own Traefik labels and network config and overwrites the deployed copy** on every
  build. Don't try to hand-tune routing/labels for prod here — those are managed in the Dokploy UI.
- There is intentionally **no CI workflow** (no GitHub Actions) — Dokploy's webhook is the CI/CD.
- The dev machine is dev-only (`npm run dev` on `localhost:5173`); Docker is not required locally.

### Verifying a deploy

After pushing, confirm the new version is live at `https://miniflux-reader.romych.pp.ua`
(or check the deployment status/logs in the Dokploy UI).
