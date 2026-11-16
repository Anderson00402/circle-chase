import type { Shape } from './encoding';

/**
 * SVG path of a marker centred on (cx, cy) with "radius" r. The three shapes have about the same
 * visual weight: the square and diamond are scaled down a little against the circle.
 */
export function shapePath(shape: Shape, cx: number, cy: number, r: number): string {
	if (shape === 'square') {
		const h = r * 0.88;
		return `M${cx - h},${cy - h}h${2 * h}v${2 * h}h${-2 * h}z`;
	}
	if (shape === 'diamond') {
		const h = r * 1.22;
		return `M${cx},${cy - h}L${cx + h},${cy}L${cx},${cy + h}L${cx - h},${cy}z`;
	}
	return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
}

/** Push labels apart vertically so none overlap (keeps their order). Returns new y values. */
export function spreadLabels(ys: number[], gap: number, lo: number, hi: number): number[] {
	const idx = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
	for (let k = 1; k < idx.length; k++) if (idx[k].y - idx[k - 1].y < gap) idx[k].y = idx[k - 1].y + gap;
	const over = idx.length ? idx[idx.length - 1].y - hi : 0;
	if (over > 0) for (const p of idx) p.y -= over;
	for (let k = 0; k < idx.length; k++) idx[k].y = Math.max(idx[k].y, lo + k * gap);
	const out = new Array<number>(ys.length);
	for (const p of idx) out[p.i] = p.y;
	return out;
}
