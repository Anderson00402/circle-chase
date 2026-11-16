import type { Cue } from '../types';

/** Seconds left at which the bar's final warning starts, and its colour. */
const WARN = 2;
const WARM = '#ffb347';

/**
 * The baseline every idea is compared against: a draining bar over the top wall.
 *
 * Written as a model cue: everything is worked out from the context (`k.power`, `k.now`), it
 * draws in one hook, uses the shared helpers for text and colour, and shows only its own signal.
 */
export const timerBar: Cue = {
	id: 'timer-bar',
	role: 'baseline',
	code: '0',
	name: 'Timer bar',
	tagline: 'A bar over the top wall drains as the power runs out.',
	description:
		'A bar along the top wall starts full and drains to the left with the power, with the seconds left written on it. In the last 2 seconds it turns amber and blinks white five times, the last blink ending as the power runs out; with reduced motion it stays steadily amber instead of blinking.',
	channel: 'hud',
	baseFlash: false,

	over(k) {
		const { ctx, T, maze: m, power, colors } = k;
		if (!power.active || k.frame.phase !== 'playing') return;
		// The bar sits inside the top wall, between its two neon lines, so it covers neither the
		// lines nor the corridor below; its glow is clipped to the wall row for the same reason.
		const bx = T * 1.2, bw = (m.W - 2.4) * T, bh = Math.max(3, T * 0.36), by = T * 0.5 - bh / 2;
		const r = bh / 2;
		// The bar's own warning in the last 2 seconds is part of this condition (it is not the ghost
		// blink): amber, blinking white on the shared rhythm (steady amber with reduced motion).
		const warn = power.left <= WARN;
		const blink = warn && !k.reduceMotion && k.baseFlash();
		const fill = blink ? '#ffffff' : warn ? WARM : colors.scared;

		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, m.W * T, T * 0.74);
		ctx.clip();

		// Track.
		ctx.fillStyle = k.rgba(colors.bg, 0.92);
		ctx.beginPath();
		ctx.roundRect(bx, by, bw, bh, r);
		ctx.fill();

		// Remaining power, with a soft top light.
		const w = bw * power.frac;
		const grad = ctx.createLinearGradient(0, by, 0, by + bh);
		grad.addColorStop(0, k.mix(fill, '#ffffff', 0.45));
		grad.addColorStop(1, fill);
		ctx.save();
		ctx.shadowColor = fill;
		ctx.shadowBlur = T * 0.3 * k.dpr;
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.roundRect(bx, by, w, bh, Math.min(r, w / 2));
		ctx.fill();
		ctx.restore();

		// Frame.
		ctx.strokeStyle = k.rgba(colors.ink, 0.75);
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(bx + 0.5, by + 0.5, bw - 1, bh - 1, r);
		ctx.stroke();

		if (bh >= 7) {
			k.text(`${power.left.toFixed(1)}s`, bx + bw / 2, by + bh / 2 + 0.5, {
				size: Math.round(bh * 0.9), font: 'mono', weight: 700, fill: colors.ink, stroke: colors.bg, strokeWidth: 3
			});
		}
		ctx.restore();
	}
};
