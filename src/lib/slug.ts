const CYRILLIC_MAP: Record<string, string> = {
	'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye',
	'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l',
	'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
	'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'yu',
	'я': 'ya', 'ъ': '', 'ы': 'y', 'э': 'e',
};

function transliterate(text: string): string {
	let result = '';
	for (const ch of text) {
		const lower = ch.toLowerCase();
		if (lower in CYRILLIC_MAP) {
			result += CYRILLIC_MAP[lower];
		} else {
			result += lower;
		}
	}
	return result;
}

export function slugify(text: string): string {
	return transliterate(text)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
}

export function makeFeedSlug(id: number, title: string): string {
	return `${id}-${slugify(title)}`;
}

export function makeEntrySlug(id: number, title: string): string {
	return `${id.toString(16)}-${slugify(title)}`;
}

export function parseFeedSlugId(slug: string): number | null {
	const m = slug.match(/^(\d+)-/);
	return m ? Number(m[1]) : null;
}

export function parseEntrySlugId(slug: string): number | null {
	const m = slug.match(/^([0-9a-f]+)-/);
	return m ? parseInt(m[1], 16) : null;
}
