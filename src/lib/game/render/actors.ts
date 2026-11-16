import {
	DIRS, type Dir, type GhostDrawOptions, type GhostId, type GhostLook, type GhostView, type Palette, type PlayerDrawOptions
} from '../types';
import { clamp, hash, mix, rgba, TAU } from './util';

/**
 * The characters.
 *
 * Hero ("Sprig"): a round lime seed-creature seen from the side, with two eyes in three-quarter
 * view and a leaf sprout on top. It eats with a mouth inside its face: a rounded opening low on the
 * front that gulps open and shut as it walks, while the whole body gives a small hop and stretch on
 * each gulp. The outline always stays a full circle. It turns to face where it goes (mirrored for
 * left, rotated for up and down).
 *
 * Wisps: flame-like spirits with a head and one swept tail that streams behind them. Each has its
 * own crest and eyelids so they can be told apart without colour: hunter has two horns and a
 * frown, ambusher a leaning flame tip and narrowed eyes, guard a flat three-point crown and level
 * eyes, drifter a smooth round head and sleepy eyes.
 */

export type HeroOptions = PlayerDrawOptions & {
	/** Multiplies the size (1 = fills about 85% of a tile). */
	scale?: number;
};
export type GhostOptions = GhostDrawOptions;

const LEAF = '#4fae3a';

/** Hero colour and the radius at tile size T. */
export const heroRadius = (T: number) => T * 0.5;

/** Maps the hero's local frame (facing +x, up is -y) onto the screen for a facing direction. */
function faceTransform(c: CanvasRenderingContext2D, face: number) {
	if (face === 1) c.scale(-1, 1);
	else if (face === 0) c.rotate(-Math.PI / 2);
	else if (face === 2) { c.rotate(Math.PI / 2); c.scale(1, -1); }
}

/**
 * Traces the hero's mouth in local coordinates (facing +x): a wide rounded opening low on the front
 * of the face, flat-ish on top and deep below, `open` 0..1.
 */
function mouthPath(c: CanvasRenderingContext2D, r: number, open: number) {
	const x0 = r * 0.3, x1 = r * 0.9, top = r * 0.16, depth = r * (0.1 + 0.36 * open);
	c.beginPath();
	c.moveTo(x0, top);
	c.quadraticCurveTo((x0 + x1) / 2, top - r * 0.05, x1, top - r * 0.04);
	c.bezierCurveTo(x1 + r * 0.02, top + depth * 0.9, x0 + r * 0.25, top + depth * 1.25, x0, top);
	c.closePath();
}

/**
 * Draws the hero centred at (cx, cy). `face` is the facing (0 up, 1 left, 2 down, 3 right),
 * `travel` the distance walked (drives the chomp), `time` game time for idle motion.
 */
export function drawHero(
	c: CanvasRenderingContext2D, pal: Palette, T: number, cx: number, cy: number,
	face: number, travel: number, moving: boolean, time: number, o: HeroOptions = {}
) {
	const r = heroRadius(T) * (o.scale ?? 1);
	if (r < 0.4) return;
	// One gulp per tile walked. Standing still, the mouth rests slightly open.
	const open = clamp(o.open ?? (moving ? 0.5 - 0.5 * Math.cos(travel * Math.PI * 2) : 0.15));
	const body = o.color ?? pal.player;
	c.save();
	if (o.alpha !== undefined) c.globalAlpha *= clamp(o.alpha);
	c.translate(cx, cy);
	faceTransform(c, face);
	// The gulp: a small hop and a stretch towards the front as the mouth opens.
	c.translate(r * 0.03 * open, -r * 0.07 * open);
	c.scale(1 + 0.05 * open, 1 - 0.04 * open);

	// Leaf sprout on the crown, leaning back, swaying a little with each step.
	if (!o.plain && r > 3) {
		const sway = Math.sin(travel * Math.PI * 2 + time * 2) * 0.12;
		c.save();
		c.translate(-r * 0.18, -r * 0.92);
		c.rotate(-0.55 + sway);
		c.fillStyle = mix(LEAF, body, 0.15);
		c.beginPath();
		c.moveTo(0, 0);
		c.quadraticCurveTo(-r * 0.55, -r * 0.2, -r * 0.62, -r * 0.62);
		c.quadraticCurveTo(-r * 0.05, -r * 0.55, 0, 0);
		c.fill();
		c.strokeStyle = mix(LEAF, '#000', 0.35);
		c.lineWidth = Math.max(0.6, r * 0.07);
		c.beginPath();
		c.moveTo(0, r * 0.05);
		c.quadraticCurveTo(-r * 0.25, -r * 0.2, -r * 0.48, -r * 0.5);
		c.stroke();
		c.restore();
	}

	// Body: always a full circle, with a soft light from the top left.
	c.beginPath();
	c.arc(0, 0, r, 0, TAU);
	const g = c.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r * 1.05);
	g.addColorStop(0, mix(body, '#ffffff', 0.55));
	g.addColorStop(0.55, body);
	g.addColorStop(1, mix(body, '#0b3d12', 0.35));
	c.fillStyle = g;
	c.fill();
	if (r > 7) {
		c.lineWidth = Math.max(1, r * 0.08);
		c.strokeStyle = rgba(mix(body, '#000000', 0.6), 0.85);
		c.stroke();
	}
	if (o.plain) { c.restore(); return; }

	// Mouth: a smile line when shut; open, a dark opening with a tongue and a lighter lip above.
	const ink = mix(body, '#000000', 0.7);
	if (open < 0.12 || r <= 3) {
		c.strokeStyle = ink;
		c.lineWidth = Math.max(0.8, r * 0.1);
		c.lineCap = 'round';
		c.beginPath();
		c.moveTo(r * 0.32, r * 0.2);
		c.quadraticCurveTo(r * 0.62, r * 0.36, r * 0.88, r * 0.14);
		c.stroke();
	} else {
		mouthPath(c, r, open);
		c.fillStyle = '#2a0d14';
		c.fill();
		if (r > 5 && open > 0.35) {
			c.save();
			c.clip();
			c.fillStyle = '#ff6f8e';
			c.beginPath();
			c.ellipse(r * 0.55, r * (0.2 + 0.36 * open), r * 0.24, r * 0.15, 0, 0, TAU);
			c.fill();
			c.restore();
			mouthPath(c, r, open);
		}
		c.lineWidth = Math.max(0.7, r * 0.06);
		c.strokeStyle = ink;
		c.lineJoin = 'round';
		c.stroke();
	}

	// Eyes, three-quarter view: the far one smaller and nearer the front edge.
	const mood = o.mood ?? 'normal';
	const eyes: [number, number, number][] = [[r * 0.2, -r * 0.3, r * 0.25], [r * 0.62, -r * 0.36, r * 0.19]];
	if (r <= 4) {
		// Tiny: one dark dot reads better than two eyes.
		c.fillStyle = '#10131f';
		c.beginPath();
		c.arc(r * 0.35, -r * 0.35, Math.max(0.6, r * 0.2), 0, TAU);
		c.fill();
	} else for (const [ex, ey, er] of eyes) {
		if (mood === 'happy') {
			c.strokeStyle = '#10131f';
			c.lineWidth = Math.max(0.8, er * 0.45);
			c.lineCap = 'round';
			c.beginPath();
			c.arc(ex, ey + er * 0.3, er * 0.75, Math.PI * 1.15, Math.PI * 1.85);
			c.stroke();
			continue;
		}
		if (mood === 'dizzy') {
			c.strokeStyle = '#10131f';
			c.lineWidth = Math.max(0.8, er * 0.4);
			c.lineCap = 'round';
			const s = er * 0.65;
			c.beginPath();
			c.moveTo(ex - s, ey - s); c.lineTo(ex + s, ey + s);
			c.moveTo(ex + s, ey - s); c.lineTo(ex - s, ey + s);
			c.stroke();
			continue;
		}
		c.fillStyle = '#ffffff';
		c.beginPath();
		c.ellipse(ex, ey, er * 0.9, er, 0, 0, TAU);
		c.fill();
		c.fillStyle = '#10131f';
		c.beginPath();
		c.ellipse(ex + er * 0.32, ey + er * 0.05, er * 0.52, er * 0.62, 0, 0, TAU);
		c.fill();
		if (er > 2.5) {
			c.fillStyle = '#ffffff';
			c.beginPath();
			c.arc(ex + er * 0.45, ey - er * 0.25, er * 0.2, 0, TAU);
			c.fill();
		}
	}
	c.restore();
}

// ---------- wisps ----------
/** Wisps are drawn a little larger than a tile so they read as clearly as the hero. */
const GHOST_SIZE = 1.13;

const CREST: Record<GhostId, 'horns' | 'flame' | 'crown' | 'round'> = {
	hunter: 'horns', ambusher: 'flame', guard: 'crown', drifter: 'round'
};

interface WispShape {
	/** y of the head centre, relative to the ghost centre. */
	hy: number;
	R: number;
	/** -1 or 1: the side the tail sweeps to (opposite to horizontal travel). */
	side: number;
}

function shapeOf(T: number, g: GhostView, index: number, scale: number): WispShape {
	const d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
	return { hy: -T * 0.08 * scale, R: T * 0.37 * scale, side: d.x ? -d.x : index % 2 ? 1 : -1 };
}

/**
 * Traces the wisp body as the current path, in screen space at (cx, cy). Returns the y of the
 * head centre. `droop` (0..1) makes the tail hang down, used for the scared look.
 */
export function wispPath(
	c: CanvasRenderingContext2D, T: number, g: GhostView, index: number, cx: number, cy: number,
	time: number, scale = 1, droop = 0, crest = true
): number {
	scale *= GHOST_SIZE;
	const { hy, R, side } = shapeOf(T, g, index, scale);
	const t = T * scale;
	const wave = Math.sin(time * 6 + index * 1.7), wave2 = Math.sin(time * 9 + index * 2.3);
	// Tail tip: swept back and down; drooping pulls it under the body.
	const tx = (t * 0.3 + wave * t * 0.05) * (1 - droop * 0.55), ty = t * 0.47 + droop * t * 0.02;
	const fx = -t * 0.14 + wave2 * t * 0.03, fy = t * 0.36 + droop * t * 0.06;
	const kind = crest && T * scale >= 12 && droop === 0 ? CREST[g.id] : 'round';
	c.save();
	c.translate(cx, cy);
	c.scale(side, 1);
	c.beginPath();
	c.moveTo(-R, hy);
	// Head and crest, left to right over the top (in the tail-right frame).
	if (kind === 'horns') {
		c.arc(0, hy, R, Math.PI, Math.PI * 1.22);
		c.quadraticCurveTo(-R * 0.62, hy - R * 1.2, -R * 0.66, hy - R * 1.32);
		c.quadraticCurveTo(-R * 0.18, hy - R * 1.1, -R * 0.2, hy - R * 0.98);
		c.quadraticCurveTo(0, hy - R * 1.04, R * 0.2, hy - R * 0.98);
		c.quadraticCurveTo(R * 0.18, hy - R * 1.1, R * 0.66, hy - R * 1.32);
		c.quadraticCurveTo(R * 0.62, hy - R * 1.2, R * Math.cos(Math.PI * 1.78), hy + R * Math.sin(Math.PI * 1.78));
		c.arc(0, hy, R, Math.PI * 1.78, 0);
	} else if (kind === 'flame') {
		c.arc(0, hy, R, Math.PI, Math.PI * 1.35);
		const lean = Math.sin(time * 5 + index) * R * 0.08;
		c.quadraticCurveTo(-R * 0.05, hy - R * 1.3, R * 0.55 + lean, hy - R * 1.55);
		c.quadraticCurveTo(R * 0.35, hy - R * 1.05, R * Math.cos(Math.PI * 1.75), hy + R * Math.sin(Math.PI * 1.75));
		c.arc(0, hy, R, Math.PI * 1.75, 0);
	} else if (kind === 'crown') {
		// Flatter head with three short points.
		c.lineTo(-R, hy - R * 0.45);
		c.quadraticCurveTo(-R, hy - R * 0.9, -R * 0.62, hy - R * 0.95);
		c.lineTo(-R * 0.48, hy - R * 1.22);
		c.lineTo(-R * 0.25, hy - R * 0.98);
		c.lineTo(0, hy - R * 1.28);
		c.lineTo(R * 0.25, hy - R * 0.98);
		c.lineTo(R * 0.48, hy - R * 1.22);
		c.lineTo(R * 0.62, hy - R * 0.95);
		c.quadraticCurveTo(R, hy - R * 0.9, R, hy - R * 0.45);
		c.lineTo(R, hy);
	} else {
		c.arc(0, hy, R, Math.PI, 0);
	}
	// Right side sweeps into the tail, then the underside with one small flick.
	c.bezierCurveTo(R * 1.02, hy + R * 0.8, tx + t * 0.1, ty - t * 0.16, tx, ty);
	c.quadraticCurveTo(t * 0.06, ty - t * 0.02, t * 0.02, fy - t * 0.07);
	c.quadraticCurveTo(-t * 0.02, fy + t * 0.03, fx, fy);
	c.bezierCurveTo(-R * 0.75, fy - t * 0.04, -R * 1.02, hy + R * 0.75, -R, hy);
	c.closePath();
	c.restore();
	return cy + hy;
}

/** Where a wisp looks, as a unit vector: along its direction, or at a point. */
function gaze(g: GhostView, cx: number, cy: number, lookAt?: [number, number]): { x: number; y: number } {
	if (lookAt) {
		const dx = lookAt[0] - cx, dy = lookAt[1] - cy, l = Math.hypot(dx, dy) || 1;
		return { x: dx / l, y: dy / l };
	}
	return g.dir >= 0 ? DIRS[g.dir as Exclude<Dir, -1>] : { x: 0, y: 0.4 };
}

/** The wisp's own eyes: dark with a glint, shaped by personality, looking along `look`. */
function wispEyes(
	c: CanvasRenderingContext2D, T: number, g: GhostView, cx: number, hy: number, scale: number,
	look: { x: number; y: number }, body: string, style: NonNullable<GhostOptions['eyes']>, ink?: string
) {
	const t = T * scale;
	if (style === 'none') return;
	const ew = t * 0.085, eh = t * 0.115;
	const ox = look.x * t * 0.07, oy = look.y * t * 0.05;
	const dark = style === 'pale' ? (ink ?? '#ffffff') : ink ?? '#0d0f1c';
	for (const s of [-1, 1]) {
		const x = cx + s * t * 0.14 + ox, y = hy + oy;
		if (style === 'closed') {
			c.strokeStyle = dark;
			c.lineWidth = Math.max(0.8, t * 0.045);
			c.lineCap = 'round';
			c.beginPath();
			c.arc(x, y - eh * 0.4, ew * 1.1, Math.PI * 0.2, Math.PI * 0.8);
			c.stroke();
			continue;
		}
		c.fillStyle = dark;
		c.beginPath();
		c.ellipse(x, y, ew, eh, 0, 0, TAU);
		c.fill();
		if (t >= 10 && style !== 'pale') {
			c.fillStyle = '#ffffff';
			c.beginPath();
			c.arc(x + ew * 0.3 + look.x * ew * 0.2, y - eh * 0.38, Math.max(0.6, ew * 0.38), 0, TAU);
			c.fill();
		}
		if (t < 14 || style !== 'normal') continue;
		// Eyelid in the body colour: the personality.
		c.fillStyle = body;
		c.beginPath();
		const lx = x - ew * 1.4, rx = x + ew * 1.4, top = y - eh * 1.5;
		if (g.id === 'hunter') {
			// Frown: lids slope down towards the middle.
			const inner = s < 0 ? rx : lx, outer = s < 0 ? lx : rx;
			c.moveTo(outer, top); c.lineTo(inner, top); c.lineTo(inner, y - eh * 0.1); c.lineTo(outer, y - eh * 0.85);
		} else if (g.id === 'ambusher') {
			// Narrowed, sly: a flat lid low over both eyes.
			c.rect(lx, top, rx - lx, eh * 1.05);
		} else if (g.id === 'drifter') {
			// Sleepy: a round lid over the top half.
			c.ellipse(x, y - eh * 0.9, ew * 1.4, eh * 0.95, 0, 0, TAU);
		} else {
			continue; // guard: steady, open eyes
		}
		c.fill();
	}
}

/** Draws one wisp in a look. */
export function drawWisp(
	c: CanvasRenderingContext2D, pal: Palette, T: number, g: GhostView, index: number, look: GhostLook,
	cx: number, cy: number, time: number, o: GhostOptions = {}
) {
	const scale = o.scale ?? 1, S = scale * GHOST_SIZE, t = T * S;
	if (t < 1) return;
	c.save();
	if (o.alpha !== undefined) c.globalAlpha *= clamp(o.alpha);
	const color = pal.ghost[g.id];

	if (look === 'eyes') {
		// Eaten: only the eyes fly home, trailing a faint outline and a few sparks.
		const d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
		c.globalAlpha *= 0.28;
		wispPath(c, T, g, index, cx, cy, time, scale, 0, false);
		c.setLineDash([t * 0.08, t * 0.08]);
		c.lineWidth = Math.max(1, t * 0.05);
		c.strokeStyle = color;
		c.stroke();
		c.setLineDash([]);
		c.globalAlpha /= 0.28;
		for (let s = 1; s <= 3; s++) {
			const k = hash(index, s, Math.floor(time * 12));
			c.fillStyle = rgba(color, 0.5 - s * 0.12);
			c.beginPath();
			c.arc(cx - d.x * t * 0.3 * s + (k - 0.5) * t * 0.15, cy - t * 0.1 - d.y * t * 0.3 * s, Math.max(0.6, t * 0.05), 0, TAU);
			c.fill();
		}
		const hy = cy - t * 0.08, look = gaze(g, cx, cy, o.lookAt);
		for (const s of [-1, 1]) {
			const x = cx + s * t * 0.15, y = hy;
			c.fillStyle = '#ffffff';
			c.beginPath();
			c.ellipse(x, y, t * 0.11, t * 0.14, 0, 0, TAU);
			c.fill();
			c.fillStyle = o.ink ?? color;
			c.beginPath();
			c.arc(x + look.x * t * 0.045, y + look.y * t * 0.06, t * 0.065, 0, TAU);
			c.fill();
		}
		c.restore();
		return;
	}

	if (look === 'scared' || look === 'scared-flash') {
		const flash = look === 'scared-flash';
		const fill = o.color ?? (flash ? pal.flash : pal.scaredFill);
		const ink = o.ink ?? (flash ? pal.flashInk : pal.scared);
		// A steady shiver: the same from the first to the last moment of the power-up.
		const jx = time ? Math.sin(time * 47 + index * 3) * t * 0.022 : 0;
		const hy = wispPath(c, T, g, index, cx + jx, cy, time, scale, 1, false);
		c.fillStyle = fill;
		c.fill();
		if (t >= 9) {
			// Diagonal stripes inside the body: the scared pattern, readable without colour.
			c.save();
			c.clip();
			c.strokeStyle = rgba(ink, flash ? 0.45 : 0.3);
			c.lineWidth = t * 0.075;
			c.beginPath();
			for (let d = -t; d <= t; d += t * 0.2) { c.moveTo(cx + d - t * 0.6, cy - t * 0.7); c.lineTo(cx + d + t * 0.6, cy + t * 0.7); }
			c.stroke();
			c.restore();
			wispPath(c, T, g, index, cx + jx, cy, time, scale, 1, false);
		}
		c.lineWidth = Math.max(1, t * 0.05);
		c.strokeStyle = ink;
		c.stroke();
		const x0 = cx + jx;
		if (t >= 7) {
			const style = o.eyes ?? 'pale';
			if (style === 'normal' || style === 'pale' || style === 'dark') {
				// Wide, startled eyes: a light ring with a small pupil, and raised brows.
				const er = Math.max(0.8, t * 0.08);
				for (const s of [-1, 1]) {
					const ex = x0 + s * t * 0.13, ey = hy + t * 0.01;
					c.fillStyle = style === 'dark' ? '#0d0f1c' : ink;
					c.beginPath();
					c.arc(ex, ey, er, 0, TAU);
					c.fill();
					if (t >= 12) {
						c.fillStyle = style === 'dark' ? ink : fill;
						c.beginPath();
						c.arc(ex, ey + er * 0.25, er * 0.42, 0, TAU);
						c.fill();
					}
				}
				if (t >= 14) {
					c.strokeStyle = style === 'dark' ? '#0d0f1c' : ink;
					c.lineWidth = Math.max(0.8, t * 0.035);
					c.lineCap = 'round';
					c.beginPath();
					for (const s of [-1, 1]) {
						c.moveTo(x0 + s * t * 0.06, hy - t * 0.11);
						c.quadraticCurveTo(x0 + s * t * 0.13, hy - t * 0.17, x0 + s * t * 0.21, hy - t * 0.12);
					}
					c.stroke();
				}
			} else wispEyes(c, T, g, x0, hy, S, { x: 0, y: 0 }, fill, style, ink);
			// A small round gasp.
			c.fillStyle = style === 'dark' ? '#0d0f1c' : ink;
			c.beginPath();
			c.ellipse(x0, hy + t * 0.18, Math.max(0.7, t * 0.05), Math.max(0.9, t * 0.065), 0, 0, TAU);
			c.fill();
		}
		c.restore();
		return;
	}

	// Normal.
	const fill = o.color ?? color;
	const hy = wispPath(c, T, g, index, cx, cy, time, scale);
	const grad = c.createLinearGradient(cx, cy - t * 0.5, cx, cy + t * 0.5);
	grad.addColorStop(0, mix(fill, '#ffffff', 0.28));
	grad.addColorStop(0.55, fill);
	grad.addColorStop(1, mix(fill, '#000000', 0.25));
	c.fillStyle = grad;
	c.fill();
	if (t >= 16) {
		c.lineWidth = Math.max(1, t * 0.04);
		c.strokeStyle = rgba(mix(fill, '#000000', 0.55), 0.7);
		c.stroke();
	}
	if (t >= 6) wispEyes(c, T, g, cx, hy, S, gaze(g, cx, cy, o.lookAt), fill, o.eyes ?? 'normal', o.ink);
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

