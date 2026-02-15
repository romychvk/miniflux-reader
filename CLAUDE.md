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
    components/
      App.svelte                # Root shell: sidebar + topbar + content
      sidebar/                  # Sidebar, FeedTree, FeedItem
      topbar/                   # TopBar (hamburger + title + logout)
      content/                  # EntryList, EntryRow, EntryContent
      ui/                       # Spinner, Toast
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
| `feeds/{id}/entries?status=unread&order=published_at&direction=desc&limit=100` | GET | Feed entries |
| `entries?status=unread&order=published_at&direction=desc&limit=100` | GET | All unread entries |
| `entries/{id}/original-content` | GET | Full article content |
| `entries` | PUT | Bulk mark read/unread |
