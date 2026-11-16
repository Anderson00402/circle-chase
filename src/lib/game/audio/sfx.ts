import type { Frame, Sfx, ToneOptions } from '../types';

/**
 * All sound is synthesized here, and all of it is original. Nothing plays until `wake()` is
 * called from a click or key press (browsers require a user gesture).
 *
 * The power-up has a steady bed (a soft pulsing drone) that starts with the power-up and simply
 * stops when it ends. It never speeds up, rises or changes in any way while the power runs down:
 * telling the player how much time is left is the countdown cue's job alone.
 */
export interface SoundBoard extends Sfx {
	/** Call from a user gesture; browsers only allow sound to start from one. */
	wake(): void;
	setEnabled(on: boolean): void;
	readonly enabled: boolean;
	/** Plays the stock sounds for a frame's events (dots, power, eat, death...). */
	play(frame: Frame): void;
	/** The short tune at the start of a game. */
	jingle(): void;
	/** Freezes all sound (pause) or lets it continue. */
	suspend(paused: boolean): void;
	/** Stops anything still sounding (new game, leaving the page). */
	reset(): void;
}

const NOTE: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
/** 'A4' -> 440, 'C#5', 'Eb3' ... */
export function noteHz(name: string): number {
	const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
	if (!m) return 440;
	const semi = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] - 4) * 12;
	return 440 * 2 ** (semi / 12);
}
const n = noteHz;

// Dots walk up and down a pentatonic pattern so long runs sound like a little tune, not a drill.
const DOT_STEPS = [0, 2, 4, 7, 9, 7, 4, 2];
const DOT_BASE = n('E5');

export function createSfx(): SoundBoard {
	let ac: AudioContext | null = null, out: GainNode | null = null, noiseBuf: AudioBuffer | null = null;
	let enabled = true, dotStep = 0, lastDot = -1;
	let bed: { stop(): void } | null = null, bedWanted = false;

	function wake() {
		if (!ac) {
			try {
				ac = new AudioContext();
				const comp = ac.createDynamicsCompressor();
				comp.threshold.value = -14;
				comp.ratio.value = 4;
				out = ac.createGain();
				out.gain.value = 0.9;
				out.connect(comp).connect(ac.destination);
				noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
				const d = noiseBuf.getChannelData(0);
				for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
			} catch { ac = null; }
		}
		if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
	}

	const live = () => !!ac && !!out && enabled;

	function tone(freq: number, dur: number, { type = 'triangle', vol = 0.06, to = 0, delay = 0 }: ToneOptions = {}) {
		if (!live()) return;
		const t0 = ac!.currentTime + delay, osc = ac!.createOscillator(), gain = ac!.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t0);
		if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur / 4));
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
		osc.connect(gain).connect(out!);
		osc.start(t0);
		osc.stop(t0 + dur + 0.03);
	}

	function noise(dur: number, { vol = 0.05, freq = 800, q = 1, delay = 0 } = {}) {
		if (!live() || !noiseBuf) return;
		const t0 = ac!.currentTime + delay;
		const src = ac!.createBufferSource(), filter = ac!.createBiquadFilter(), gain = ac!.createGain();
		src.buffer = noiseBuf;
		filter.type = 'bandpass';
		filter.frequency.value = freq;
		filter.Q.value = q;
		gain.gain.setValueAtTime(vol, t0);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
		src.connect(filter).connect(gain).connect(out!);
		src.start(t0, Math.random() * 1.5, dur + 0.05);
	}

	function arp(freqs: number[], gap: number, { dur = 0.12, ...o }: ToneOptions & { dur?: number } = {}) {
		freqs.forEach((f, i) => tone(f, dur, { ...o, delay: (o.delay ?? 0) + i * gap }));
	}

	// ---- power-up bed: constant from start to stop ----
	function bedStart() {
		bedWanted = true;
		if (bed || !live()) return;
		const t0 = ac!.currentTime;
		const master = ac!.createGain();
		master.gain.setValueAtTime(0.0001, t0);
		master.gain.exponentialRampToValueAtTime(1, t0 + 0.08);
		master.connect(out!);
		// Two low voices a fifth apart, a slow filter and a steady tremolo.
		const lp = ac!.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 700;
		lp.Q.value = 3;
		const trem = ac!.createGain();
		trem.gain.value = 0.5;
		lp.connect(trem).connect(master);
		const lfo = ac!.createOscillator(), lfoAmt = ac!.createGain();
		lfo.frequency.value = 5; // pulses per second, fixed
		lfoAmt.gain.value = 0.5;
		lfo.connect(lfoAmt).connect(trem.gain);
		const voices = [[n('A2'), 'sawtooth', 0.035], [n('E3'), 'square', 0.018], [n('A3'), 'triangle', 0.03]] as const;
		const oscs = voices.map(([f, type, vol]) => {
			const o = ac!.createOscillator(), g = ac!.createGain();
			o.type = type;
			o.frequency.value = f;
			g.gain.value = vol;
			o.connect(g).connect(lp);
			o.start(t0);
			return o;
		});
		lfo.start(t0);
		bed = {
			stop() {
				if (!ac) return;
				const t = ac.currentTime;
				master.gain.cancelScheduledValues(t);
				master.gain.setValueAtTime(master.gain.value || 0.0001, t);
				master.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
				for (const o of [...oscs, lfo]) o.stop(t + 0.08);
			}
		};
	}
	function bedStop(forget = true) {
		if (forget) bedWanted = false;
		bed?.stop();
		bed = null;
	}

	function jingle() {
		if (!live()) return;
		// An original bright motif over a walking bass, about 1.6 s (fits the READY pause).
		const s = 0.12;
		const lead: [string, number][] = [['E5', 1], ['A5', 1], ['C#6', 1], ['E6', 2], ['C#6', 1], ['D6', 1], ['B5', 1], ['G#5', 1], ['A5', 1], ['B5', 1], ['C#6', 2]];
		let at = 0;
		for (const [note, len] of lead) {
			tone(n(note), s * len * 0.95, { type: 'square', vol: 0.032, delay: at });
			tone(n(note) * 2, s * len * 0.6, { type: 'triangle', vol: 0.012, delay: at });
			at += s * len;
		}
		const bass: [string, number][] = [['A2', 2], ['E3', 2], ['F#3', 2], ['E3', 2], ['D3', 2], ['E3', 2], ['A2', 2]];
		at = 0;
		for (const [note, len] of bass) { tone(n(note), s * len * 0.9, { type: 'triangle', vol: 0.07, delay: at }); at += s * len; }
		noise(0.05, { vol: 0.03, freq: 6000, q: 2, delay: at - s * 2 });
	}

	function play(frame: Frame) {
		let dotDone = false;
		const types = frame.events.map((e) => e.type);
		for (const e of frame.events) {
			switch (e.type) {
				case 'dot': {
					if (dotDone) break;
					dotDone = true;
					// Restart the little tune after a pause, so it feels like it follows your runs.
					if (e.t - lastDot > 0.6) dotStep = 0;
					lastDot = e.t;
					const f = DOT_BASE * 2 ** (DOT_STEPS[dotStep++ % DOT_STEPS.length] / 12);
					tone(f, 0.055, { type: 'triangle', vol: 0.035, to: f * 0.8 });
					tone(f * 2, 0.025, { type: 'sine', vol: 0.01 });
					break;
				}
				case 'power':
					tone(n('A3'), 0.28, { type: 'sawtooth', vol: 0.03, to: n('A5') });
					arp([n('A4'), n('C#5'), n('E5'), n('A5')], 0.04, { type: 'triangle', vol: 0.04, dur: 0.18, delay: 0.12 });
					bedStart();
					break;
				case 'powerEnd':
					// A refresh is followed by a new 'power' event in the same frame: keep the bed going.
					if (e.reason !== 'refreshed' || !types.includes('power')) bedStop();
					break;
				case 'eat': {
					const step = Math.log2(Math.max(1, e.points / 200)); // 0, 1, 2, 3 along a chain
					const base = n('E5') * 2 ** ((step * 3) / 12);
					arp([base, base * 1.26, base * 1.5, base * 2], 0.035, { type: 'square', vol: 0.03, dur: 0.07 });
					noise(0.12, { vol: 0.05, freq: 2500, q: 0.8 });
					break;
				}
				case 'bonus':
					arp([n('C6'), n('E6'), n('G6'), n('C7'), n('G6'), n('C7')], 0.05, { type: 'triangle', vol: 0.04, dur: 0.1 });
					break;
				case 'die':
					bedStop();
					tone(n('E5'), 0.7, { type: 'sawtooth', vol: 0.035, to: n('E3'), delay: 0.32 });
					tone(n('B4'), 0.7, { type: 'triangle', vol: 0.03, to: n('B2'), delay: 0.34 });
					noise(0.25, { vol: 0.08, freq: 900, q: 0.7, delay: 0.98 });
					tone(n('E2'), 0.25, { type: 'sine', vol: 0.12, to: n('E1'), delay: 0.98 });
					break;
				case 'clear':
					bedStop();
					arp([n('A4'), n('C#5'), n('E5'), n('A5'), n('C#6'), n('E6')], 0.07, { type: 'square', vol: 0.03, dur: 0.14 });
					arp([n('A5'), n('E6'), n('A6')], 0.0, { type: 'triangle', vol: 0.03, dur: 0.6, delay: 0.5 });
					break;
				case 'level':
					arp([n('E5'), n('A5'), n('E6')], 0.09, { type: 'triangle', vol: 0.04, dur: 0.14 });
					break;
				case 'extra':
					arp([n('B5'), n('E6'), n('G#6'), n('B6'), n('E7')], 0.06, { type: 'sine', vol: 0.05, dur: 0.2 });
					break;
				case 'over':
					bedStop();
					arp([n('E4'), n('C4'), n('A3'), n('E3')], 0.22, { type: 'triangle', vol: 0.06, dur: 0.3 });
					break;
			}
		}
	}

	return {
		wake, tone, noise, arp, play, jingle,
		note: noteHz,
		setEnabled(on) {
			if (on === enabled) return;
			enabled = on;
			if (!on) bedStop(false);
			else if (bedWanted) bedStart();
		},
		get enabled() { return enabled; },
		suspend(paused) {
			if (!ac) return;
			if (paused) ac.suspend().catch(() => {});
			else ac.resume().catch(() => {});
		},
		reset() { bedStop(); dotStep = 0; lastDot = -1; }
	};
}
