import { minifluxBackend } from './miniflux';
import type { BackendKind, ReaderBackend } from './types';

// The backends this build ships. Repo-specific by design: a fork adds its own engine here and
// nowhere else, so every other file under $lib/backend stays identical between the repos.
export const BACKENDS: Partial<Record<BackendKind, ReaderBackend>> = {
	miniflux: minifluxBackend
};
