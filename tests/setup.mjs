// Registers the extensionless-relative-import resolve hook (see hooks.mjs) before the test
// files load. Wired via `node --import ./tests/setup.mjs --test`.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
