export function relaTimestamp(t: string): string {
	const d = (Date.now() - Date.parse(t)) / 1000;
	if (d > 60 * 60 * 24) {
		return Math.floor(d / (60 * 60 * 24)) + 'd';
	} else if (d > 60 * 60) {
		return Math.floor(d / (60 * 60)) + 'h';
	} else {
		return Math.max(1, Math.floor(d / 60)) + 'm';
	}
}
