import {
	DIRS, type Dir, type GhostDrawOptions, type GhostLook, type GhostView, type Palette, type PlayerDrawOptions
} from '../types';
import { clamp, rgba, TAU } from './util';

/**
 * The characters, in the look of the first version of the game.
 *
 * Hero: a plain yellow circle. It has no mouth and no face: the circle stays whole at all times
 * (a wedge cut out of a circle is another game's character, see AGENTS.md). Eating shows as a
 * gulp: the circle reaches toward the dot ahead, stretching along its facing, and settles back as
 * the dot goes down.
 *
 * Ghosts: a round head that tapers into one wispy tail. The tail streams away from the way the
 * ghost is moving and sways as it floats; two simple dark eyes with a glint look where it goes.
 * Scared, the body is a faint fill inside a dashed outline, eyes in the same ink.
 */

export type HeroOptions = PlayerDrawOptions & {
	/** Multiplies the size (1 = the circle fills 80% of a tile). */
	scale?: number;
	/**
	 * Gulp stretch along the facing: 0 at rest, up to about 0.24 reaching for a power dot, a little
	 * negative while settling back. The renderer works it out from the scene.
	 */
	gulp?: number;
};
export type GhostOptions = GhostDrawOptions;

/** The hero's radius at tile size T. */
export const heroRadius = (T: number) => T * 0.4;

/**
 * Draws the hero centred at (cx, cy). `face` is the facing (0 up, 1 left, 2 down, 3 right).
 * `travel`, `moving` and `time` are kept for callers; the plain circle does not use them.
 */
export function drawHero(
	c: CanvasRenderingContext2D, pal: Palette, T: number, cx: number, cy: number,
	face: number, travel: number, moving: boolean, time: number, o: HeroOptions = {}
) {
	void travel; void moving; void time;
	const r = heroRadius(T) * (o.scale ?? 1);
	if (r < 0.4) return;
	const s = o.gulp ?? 0;
	const d = DIRS[face as Exclude<Dir, -1>] ?? DIRS[3];
	c.save();
	if (o.alpha !== undefined) c.globalAlpha *= clamp(o.alpha);
	// The gulp: the circle shifts and stretches toward where it faces, then settles back.
	c.translate(cx + d.x * s * r * 0.5, cy + d.y * s * r * 0.5);
	c.rotate(Math.atan2(d.y, d.x));
	c.scale(1 + s, 1 - s * 0.6);
	c.fillStyle = o.color ?? pal.player;
	c.beginPath();
	c.arc(0, 0, r, 0, TAU);
	c.fill();
	c.restore();
}

// ---------- ghosts ----------
/** Line width of a ghost's outline (scared and eaten looks) at size t. */
export const ghostLine = (t: number) => Math.max(1, Math.min(1.5, t * 0.12), t * 0.07);

/**
 * Traces the ghost body as the current path, in screen space at (cx, cy). Returns the y of the
 * head centre. Every look uses the same body; only fill, outline and eyes change.
 */
export function wispPath(
	c: CanvasRenderingContext2D, T: number, g: GhostView, index: number, cx: number, cy: number,
	time: number, scale = 1
): number {
	const t = T * scale, R = t * 0.37, hy = -t * 0.1;
	const d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
	// The tail curls behind a ghost moving sideways; going up or down, each ghost keeps its own side.
	const side = d.x ? -d.x : index % 2 ? 1 : -1;
	const tx = t * 0.22 + Math.sin(time * 5 + index * 1.7) * t * 0.06, ty = t * 0.47;
	c.save();
	c.translate(cx, cy);
	c.scale(side, 1); // the path keeps this mirroring after restore()
	c.beginPath();
	c.moveTo(-R, hy);
	c.arc(0, hy, R, Math.PI, 0);
	c.bezierCurveTo(R, hy + R, tx + t * 0.12, ty - t * 0.1, tx, ty);
	c.bezierCurveTo(tx - t * 0.1, ty - t * 0.05, -R * 0.9, hy + R * 0.9, -R, hy);
	c.closePath();
	c.restore();
	return cy + hy;
}

/** Where a ghost looks, as a vector: along its direction (none when it has none), or at a point. */
function gaze(g: GhostView, cx: number, cy: number, lookAt?: [number, number]): { x: number; y: number } {
	if (lookAt) {
		const dx = lookAt[0] - cx, dy = lookAt[1] - cy, l = Math.hypot(dx, dy) || 1;
		return { x: dx / l, y: dy / l };
	}
	return g.dir >= 0 ? DIRS[g.dir as Exclude<Dir, -1>] : { x: 0, y: 0 };
}

/** Two simple eyes, optionally with a white glint, or closed (a short arc each). */
function ghostEyes(
	c: CanvasRenderingContext2D, t: number, cx: number, hy: number, look: { x: number; y: number },
	color: string, glint: boolean, closed = false
) {
	const ew = Math.max(0.6, t * 0.06), eh = Math.max(0.8, t * 0.09);
	for (const side of [-1, 1]) {
		const x = cx + side * t * 0.13 + look.x * t * 0.06, y = hy + look.y * t * 0.05;
		if (closed) {
			c.strokeStyle = color;
			c.lineWidth = Math.max(0.8, t * 0.04);
			c.lineCap = 'round';
			c.beginPath();
			c.arc(x, y - eh * 0.4, ew * 1.3, Math.PI * 0.2, Math.PI * 0.8);
			c.stroke();
			continue;
		}
		c.fillStyle = color;
		c.beginPath();
		c.ellipse(x, y, ew, eh, 0, 0, TAU);
		c.fill();
		if (glint && t >= 10) {
			c.fillStyle = '#ffffff';
			c.beginPath();
			c.arc(x + t * 0.018, y - t * 0.035, t * 0.022, 0, TAU);
			c.fill();
		}
	}
}

/** Draws one ghost in a look. */
export function drawWisp(
	c: CanvasRenderingContext2D, pal: Palette, T: number, g: GhostView, index: number, look: GhostLook,
	cx: number, cy: number, time: number, o: GhostOptions = {}
) {
	const scale = o.scale ?? 1, t = T * scale;
	if (t < 1) return;
	c.save();
	if (o.alpha !== undefined) c.globalAlpha *= clamp(o.alpha);
	const own = pal.ghost[g.id], lw = ghostLine(t), style = o.eyes ?? 'normal';
	const dir = gaze(g, cx, cy, o.lookAt);
	const hy = wispPath(c, T, g, index, cx, cy, time, scale);

	if (look === 'eyes') {
		// Eaten: a faint dotted outline with its eyes, drifting back to the pen.
		const color = o.color ?? own;
		c.globalAlpha *= 0.55;
		c.setLineDash([t * 0.07, t * 0.07]);
		c.lineWidth = lw;
		c.strokeStyle = color;
		c.stroke();
		c.setLineDash([]);
		if (style !== 'none') ghostEyes(c, t, cx, hy, dir, o.ink ?? color, false, style === 'closed');
		c.restore();
		return;
	}

	if (look === 'scared' || look === 'scared-flash') {
		// Scared: a faint fill inside a dashed outline, eyes in the same ink (white for the blink).
		const ink = o.ink ?? (look === 'scared-flash' ? pal.flash : pal.scaredInk ?? pal.scared);
		c.fillStyle = o.color ?? pal.scaredFill;
		c.fill();
		c.setLineDash([t * 0.14, t * 0.09]);
		c.lineWidth = lw;
		c.strokeStyle = ink;
		c.stroke();
		c.setLineDash([]);
		if (style !== 'none') {
			const dark = style === 'dark';
			ghostEyes(c, t, cx, hy, dir, dark ? pal.bg : ink, dark, style === 'closed');
		}
		c.restore();
		return;
	}

	// Normal: a solid body in its own colour, dark eyes with a glint.
	c.fillStyle = o.color ?? own;
	c.fill();
	if (style !== 'none') {
		const pale = style === 'pale';
		ghostEyes(c, t, cx, hy, dir, o.ink ?? (pale ? '#ffffff' : pal.bg), !pale, style === 'closed');
	}
	c.restore();
}

/** Soft circular glow (radial gradient), cheap enough to draw every frame. */
export function softGlow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 1) {
	if (r <= 0 || alpha <= 0) return;
	const g = c.createRadialGradient(x, y, 0, x, y, r);
	g.addColorStop(0, rgba(color, 0.6 * alpha));
	g.addColorStop(0.4, rgba(color, 0.22 * alpha));
	g.addColorStop(1, rgba(color, 0));
	c.fillStyle = g;
	c.fillRect(x - r, y - r, r * 2, r * 2);
}
