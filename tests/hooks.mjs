// Resolve hook for `node --test`: the app's source uses extensionless relative imports
// (e.g. `import './storage'`), which Vite resolves but Node's ESM loader does not. When a
// relative specifier has no JS/TS extension, try the `.ts` file first, then fall back.
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

// SvelteKit's `$lib` alias, which Vite knows and Node does not. Rewritten to a file URL under
// src/lib so a module can import the way the app does and still be unit-testable.
// The trailing slash is load-bearing: path.resolve strips it, and without it '$lib/storage'
// concatenates into '…/src/libstorage'.
const LIB_ROOT = `${pathToFileURL(resolvePath(process.cwd(), 'src/lib')).href}/`;

const ENV_STUB = new URL('./env-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	// SvelteKit's virtual env modules have no Node equivalent — see env-stub.mjs.
	if (specifier === '$env/dynamic/private' || specifier === '$env/dynamic/public') {
		return { url: ENV_STUB, shortCircuit: true };
	}
	if (specifier === '$lib' || specifier.startsWith('$lib/')) {
		const rest = specifier.slice('$lib/'.length);
		const target = `${LIB_ROOT}${rest}`;
		if (!/\.[cm]?[jt]s$/.test(target)) {
			try {
				return await nextResolve(`${target}.ts`, context);
			} catch {
				/* fall through */
			}
		}
		return nextResolve(target, context);
	}
	if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
		try {
			return await nextResolve(specifier + '.ts', context);
		} catch {
			/* fall through to the default resolution below */
		}
	}
	return nextResolve(specifier, context);
}
