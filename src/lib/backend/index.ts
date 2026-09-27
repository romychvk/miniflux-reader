import { auth } from '$lib/stores/auth.svelte';
import { BACKENDS } from './register';
import type { BackendCapabilities, BackendKind, ReaderBackend } from './types';

export type { BackendCapabilities, BackendKind, CurrentUser, EntryPage, EntryQuery, ReaderBackend } from './types';
export { feedIdOf } from './scope';

// The backend the signed-in session talks to. Resolved on every call rather than captured, so a
// logout/login that switches kinds is picked up without a reload.
export function backend(): ReaderBackend {
	const impl = BACKENDS[auth.backend];
	if (!impl) throw new Error(`No "${auth.backend}" backend in this build`);
	return impl;
}

export function hasBackend(kind: BackendKind): boolean {
	return kind in BACKENDS;
}

// Capabilities of the current backend; the Miniflux defaults when nobody is signed in yet, so
// components rendered before login (none today) still get an answer.
export function caps(): BackendCapabilities {
	return (BACKENDS[auth.backend] ?? BACKENDS.miniflux)!.caps;
}
