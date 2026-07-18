// Resolve hook for `node --test`: the app's source uses extensionless relative imports
// (e.g. `import './storage'`), which Vite resolves but Node's ESM loader does not. When a
// relative specifier has no JS/TS extension, try the `.ts` file first, then fall back.
export async function resolve(specifier, context, nextResolve) {
	if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
		try {
			return await nextResolve(specifier + '.ts', context);
		} catch {
			/* fall through to the default resolution below */
		}
	}
	return nextResolve(specifier, context);
}
