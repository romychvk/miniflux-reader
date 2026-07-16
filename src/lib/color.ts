/**
 * Minimal sRGB ↔ OKLCH conversion (Björn Ottosson's OKLab), dependency-free.
 * Used by the theme generator to build perceptually even color ramps.
 * All public API works in hex so values plug straight into <input type="color">.
 */

export interface Oklch {
	/** Lightness, 0..1 */
	l: number;
	/** Chroma, 0 (gray) .. ~0.37 (max sRGB) */
	c: number;
	/** Hue in degrees, 0..360 */
	h: number;
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Linear sRGB → OKLab */
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	];
}

/** OKLab → linear sRGB (may fall outside [0,1] for out-of-gamut colors) */
function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
	];
}

export function hexToOklch(hex: string): Oklch {
	let s = hex.replace('#', '').trim();
	if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
	const r = srgbToLinear(parseInt(s.slice(0, 2), 16) / 255);
	const g = srgbToLinear(parseInt(s.slice(2, 4), 16) / 255);
	const b = srgbToLinear(parseInt(s.slice(4, 6), 16) / 255);
	const [L, A, B] = rgbToOklab(r, g, b);
	const c = Math.hypot(A, B);
	let h = (Math.atan2(B, A) * 180) / Math.PI;
	if (h < 0) h += 360;
	return { l: L, c, h };
}

function inGamut(rgb: [number, number, number]): boolean {
	const eps = 1e-5;
	return rgb.every((v) => v >= -eps && v <= 1 + eps);
}

function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
	const rad = (h * Math.PI) / 180;
	return oklabToRgb(l, c * Math.cos(rad), c * Math.sin(rad));
}

/**
 * OKLCH → hex. Out-of-gamut colors keep their lightness and hue; chroma is
 * reduced (binary search) until the color fits sRGB.
 */
export function oklchToHex(color: Oklch): string {
	const l = Math.min(1, Math.max(0, color.l));
	let rgb = toLinearRgb({ ...color, l });
	if (!inGamut(rgb)) {
		let lo = 0;
		let hi = color.c;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (inGamut(toLinearRgb({ l, c: mid, h: color.h }))) lo = mid;
			else hi = mid;
		}
		rgb = toLinearRgb({ l, c: lo, h: color.h });
	}
	return (
		'#' +
		rgb
			.map((v) => {
				const b = Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
				return b.toString(16).padStart(2, '0');
			})
			.join('')
	);
}
