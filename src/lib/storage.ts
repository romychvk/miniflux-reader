export function storageGet<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function storageGetString(key: string, fallback: string = ''): string {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

export function storageSet(key: string, value: unknown): void {
	try {
		if (typeof value === 'string') {
			localStorage.setItem(key, value);
		} else {
			localStorage.setItem(key, JSON.stringify(value));
		}
	} catch {
		// QuotaExceededError or SecurityError — silently fail
	}
}

export function storageRemove(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// SecurityError — silently fail
	}
}
