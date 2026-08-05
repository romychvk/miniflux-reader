# Miniflux Reader

A polished web client for [Miniflux](https://miniflux.app) — bring your own Miniflux instance,
log in with its URL and an API token, and read.

Built with SvelteKit, Svelte 5 (runes) and Tailwind CSS 4. Ships as a single Node container.

## Features

**Reading**
- Feed sidebar with categories, favicons, unread counters and drag-to-reorder
- List and card layouts, an optional three-column mode with a persistent article panel
- Inline expand or a full-page article view with deep links; image lightbox
- "Fetch original content" — re-scrape the source page when the feed is truncated, with
  per-feed scraper/rewrite rules and lead-image handling
- Auto-mark-read on scroll, bulk mark-read, starred view, full-text search

**Taming noisy feeds**
- Per-feed filters with a friendly rule builder (title/content/link/author, contains or regex)
  in two modes: compile to Miniflux's server-side rules ("don't download") or hide locally
  ("mark read", reversible)
- An **AI assistant** (bring your own Anthropic/OpenAI key) that writes Miniflux scraper and
  rewrite rules for you from sample articles, with preview and refine turns
- Per-feed duplicate collapsing, custom cover-image extraction rules, User-Agent presets

**Feeds for sites without RSS**
- First-class [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) integration: point the app
  at your bridge instance, and the add-feed flow offers ready-made bridges plus a CSS-selector
  wizard (AI-assisted) for scraping arbitrary pages into feeds

**Comfort**
- Theme system with a built-in theme editor (design tokens, light/dark)
- Settings sync: your localStorage settings follow you across browsers via a small
  server-side blob keyed to your Miniflux identity
- Responsive: sidebar on desktop, drawer on mobile

**Security posture**
- Your Miniflux API token stays in your browser; the server proxies requests without storing it
- Helper endpoints (page fetching, image lookup, bridge catalog, AI proxy) are gated by your
  Miniflux credentials and guarded against SSRF (private-network and DNS-rebinding checks)
- Sanitized article HTML (DOMPurify) behind a nonce-based CSP; per-IP rate limits on the API

## Quick start (Docker)

```yaml
# docker-compose.yml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      # Optional: pin the Miniflux instance this deployment accepts (empty = any)
      - ALLOWED_MINIFLUX_SERVER=${ALLOWED_MINIFLUX_SERVER:-}
    ports:
      - "3000:3000"
    volumes:
      - settings-data:/app/data

volumes:
  settings-data:
```

```bash
docker compose up -d --build
```

Open http://localhost:3000, enter your Miniflux server URL and an API token
(Miniflux → Settings → API Keys).

## Quick start (from source)

```bash
pnpm install
pnpm dev        # dev server on localhost:5173
```

Production build (adapter-node → standalone Node server):

```bash
pnpm build      # runs svelte-check + tests first
node build
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ALLOWED_MINIFLUX_SERVER` | *(empty — any server)* | Pin the Miniflux origin this deployment will talk to; other values get 403 |
| `SETTINGS_DATA_DIR` | `data` | Where per-user settings blobs are stored (volume in Docker) |
| `PORT` | `3000` | HTTP port of the Node server |

## How it works

All Miniflux API calls go through a server-side proxy route (`/api/proxy/[...path]`) — this
avoids CORS and keeps a single origin. Credentials live in your browser's localStorage and are
sent as headers per request; the server validates them against your Miniflux `/v1/me` and never
persists them. Everything above vanilla Miniflux (filters in "hide" mode, dedup, cover rules,
theme, layout) is client-side per-feed configuration, mirrored to a per-user settings blob so it
syncs across devices.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: `pnpm check` and `pnpm test` must be
green; tabs; keep components small.

## License

[Apache-2.0](LICENSE)
