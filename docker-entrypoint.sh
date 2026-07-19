#!/bin/sh
set -e

# The settings volume mounted at /app/data may be either a fresh Docker named volume (which inherits
# the image's node-owned /app/data) or an older volume created while the container ran as root (whose
# files are root-owned). Before dropping privileges, make sure the unprivileged `node` user can write
# it, then hand off to `node build` as that user so the app itself never runs as root.
#
# Runs on every start; the chown is idempotent and cheap. Guarded on uid so it's a no-op if the
# container is ever started as a non-root user directly.
if [ "$(id -u)" = "0" ]; then
	chown -R node:node /app/data 2>/dev/null || true
	exec su-exec node "$@"
fi

exec "$@"
