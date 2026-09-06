// Stands in for SvelteKit's `$env/dynamic/private` under `node --test`, which has no Vite to
// provide it. Values come from the real process env, which is what the module does in production
// anyway — so a test can point e.g. IMAGE_ARCHIVE_DIR at a temp directory.
export const env = process.env;
