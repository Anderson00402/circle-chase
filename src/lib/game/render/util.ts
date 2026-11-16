/**
 * Small pure helpers shared by the renderer and the cues: easing, deterministic randomness,
 * colour mixing and fonts. Nothing here keeps state between frames (colour parsing is cached,
 * which is fine because the same input always gives the same output).
 */

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 below `e0`, 1 above `e1`, smooth in between. */
export const smoothstep = (e0: number, e1: number, x: number) => {
	const k = clamp((x - e0) / (e1 - e0 || 1));
	return k * k * (3 - 2 * k);
};

/** Easing curves: each takes 0..1 and returns 0..1 (outBack and outElastic overshoot a little). */
export const ease = {
	linear: (k: number) => clamp(k),
	inQuad: (k: number) => clamp(k) ** 2,
	outQuad: (k: number) => 1 - (1 - clamp(k)) ** 2,
	inOutQuad: (k: number) => ((k = clamp(k)) < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2),
	inCubic: (k: number) => clamp(k) ** 3,
	outCubic: (k: number) => 1 - (1 - clamp(k)) ** 3,
	inOutCubic: (k: number) => ((k = clamp(k)) < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
	outBack: (k: number) => {
		k = clamp(k);
		const c = 1.70158;
		return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
	},
	outElastic: (k: number) => {
		k = clamp(k);
		return k === 0 || k === 1 ? k : 2 ** (-10 * k) * Math.sin((k * 10 - 0.75) * (TAU / 3)) + 1;
	},
	/** 0 -> 1 -> 0 over 0..1: handy for one-off pulses and flashes. */
	bump: (k: number) => Math.sin(clamp(k) * Math.PI)
};
export type Easing = keyof typeof ease;

/** Deterministic 0..1 from any numbers. Same inputs, same output: use it for stateless particles. */
export function hash(...n: number[]): number {
	let h = 0x811c9dc5;
	for (const v of n) {
		// Fold the float into two 32-bit integers so nearby inputs land far apart.
		const a = Math.floor(v * 1000) | 0, b = Math.floor(v) | 0;
		h = Math.imul(h ^ a, 0x01000193);
		h = Math.imul(h ^ b, 0x5bd1e995);
		h ^= h >>> 15;
	}
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Smooth 1D value noise in 0..1. `noise(now * 3, 7)` wanders gently and repeats exactly in a replay. */
export function noise(x: number, seed = 0): number {
	const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
	return lerp(hash(i, seed), hash(i + 1, seed), u);
}

// ---------- colour ----------
type RGBA = [number, number, number, number];
const parsed = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour to [r, g, b, a] (0-255, alpha 0-1). Cached. */
export function rgbaOf(color: string): RGBA {
	const hit = parsed.get(color);
	if (hit) return hit;
	let out: RGBA = [255, 255, 255, 1];
	const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
	if (hex) {
		let h = hex[1];
		if (h.length <= 4) h = [...h].map((c) => c + c).join('');
		const n = parseInt(h.slice(0, 6), 16);
		out = [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
	} else {
		// Let the browser normalise anything else (rgb(), hsl(), names).
		if (!probe && typeof document !== 'undefined') probe = document.createElement('canvas').getContext('2d');
		if (probe) {
			probe.fillStyle = '#000';
			probe.fillStyle = color;
			const s = String(probe.fillStyle);
			if (s.startsWith('#')) return (parsed.set(color, rgbaOf(s)), rgbaOf(s));
			const m = s.match(/[\d.]+/g);
			if (m) out = [+m[0], +m[1], +m[2], m[3] !== undefined ? +m[3] : 1];
		}
	}
	parsed.set(color, out);
	return out;
}

/** `color` with its alpha multiplied by `alpha`. */
export function rgba(color: string, alpha: number): string {
	const [r, g, b, a] = rgbaOf(color);
	return `rgba(${r},${g},${b},${+(a * clamp(alpha)).toFixed(3)})`;
}

/** Blend two colours: k = 0 gives `a`, k = 1 gives `b`. */
export function mix(a: string, b: string, k: number, alpha = 1): string {
	const A = rgbaOf(a), B = rgbaOf(b);
	k = clamp(k);
	const c = (i: number) => Math.round(lerp(A[i], B[i], k));
	return `rgba(${c(0)},${c(1)},${c(2)},${+(lerp(A[3], B[3], k) * alpha).toFixed(3)})`;
}

/** Relative luminance 0..1, for picking readable text on a colour. */
export function luminance(color: string): number {
	const [r, g, b] = rgbaOf(color).map((v, i) => (i < 3 ? ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : v));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------- fonts ----------
export interface Fonts {
	display: string;
	body: string;
	mono: string;
}
const FALLBACK: Fonts = {
	display: '"Bricolage Grotesque", ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
	body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
	mono: '"Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace'
};
let fonts: Fonts | null = null, fontsAt = 0;

/** Font stacks from the app's design tokens (`--font-display` ...), re-read at most once a second. */
export function appFonts(): Fonts {
	if (typeof document === 'undefined') return FALLBACK;
	const now = performance.now();
	if (fonts && now - fontsAt < 1000) return fonts;
	const cs = getComputedStyle(document.documentElement);
	const get = (name: string, def: string) => cs.getPropertyValue(name).trim() || def;
	fonts = { display: get('--font-display', FALLBACK.display), body: get('--font-body', FALLBACK.body), mono: get('--font-mono', FALLBACK.mono) };
	fontsAt = now;
	return fonts;
}
