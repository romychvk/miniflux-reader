# Pinned base: node 22.23.1 (>= 22.18, the minimum for default native TS type-stripping) plus its
# digest, so builds are reproducible. Bump the version AND the digest together when updating —
# a pinned digest won't auto-pull upstream security patches.
ARG NODE_IMAGE=node:22.23.1-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /app

# Build stage — needs all deps (vite/svelte/tailwind/etc.) to run `pnpm run build`.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production dependencies only — the runtime needs just dompurify/ipaddr.js/lucide-svelte (+ their
# transitive deps); every devDependency is build-time. Verified the app boots with this set alone.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Runtime — non-root, prod-only deps, no build toolchain.
FROM ${NODE_IMAGE}
# su-exec drops privileges from the entrypoint (see docker-entrypoint.sh).
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./
# Pre-create the settings dir owned by node so a *fresh* named volume inherits node ownership.
# An *existing* (older, root-owned) volume is fixed at startup by the entrypoint.
RUN mkdir -p /app/data && chown -R node:node /app/data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# The entrypoint fixes /app/data ownership (for pre-existing root-owned volumes) then runs the app
# as the unprivileged `node` user. Runtime process is non-root; root is used only for the chown.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
