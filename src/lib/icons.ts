function hashCode(s: string): number {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		hash = s.charCodeAt(i) + ((hash << 5) - hash);
	}
	return hash;
}

export function createFeedIcon(feedName: string): string {
	const canvas = document.createElement('canvas');
	canvas.width = 16;
	canvas.height = 16;
	const ctx = canvas.getContext('2d')!;

	const hue = Math.abs(hashCode(feedName)) % 360;

	ctx.fillStyle = `hsl(${hue}, 50%, 25%)`;
	ctx.fillRect(0, 0, 16, 16);

	ctx.fillStyle = `hsl(${360 - hue}, 100%, 75%)`;
	ctx.font = 'bold 14px sans-serif';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'center';
	ctx.fillText(feedName[0] || '?', 8, 9);

	return canvas.toDataURL();
}
