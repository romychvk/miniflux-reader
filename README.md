# Miniflux Reader

A lightweight web frontend for [Miniflux](https://miniflux.app) RSS reader.

Built with SvelteKit, Svelte 5, and Tailwind CSS 4.

## Features

- Login with Miniflux server URL and API token
- Feed sidebar with categories, feed icons, and unread counters
- Entry list for selected feed (unread, newest first)
- Expand/collapse articles inline with lazy-fetched full content
- Auto-mark-read on scroll (IntersectionObserver)
- Manual read/unread toggle
- Responsive layout (sidebar on desktop, drawer on mobile)
- Error toast notifications

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter your Miniflux server URL and API token.

## How it works

The app proxies all Miniflux API requests through a SvelteKit server route (`/api/proxy/[...path]`) to avoid CORS issues. Authentication credentials are stored in localStorage and sent as custom headers on each request.

## Production

```bash
npm run build
node build
```

Uses `@sveltejs/adapter-node` — outputs a standalone Node.js server.
