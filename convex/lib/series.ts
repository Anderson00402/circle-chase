/**
 * A trial's 10 Hz series packed into bytes (about 1 KB for 11 s) so trial documents stay light
 * when a summary query scans many of them. The browser packs it; `trials:get` unpacks it.
 */
import { Reader, Writer } from './pack';

export interface Series {
	t: number[];
	left: number[];
	dist: (number | null)[];
	chasing: number[];
	px: number[];
	py: number[];
}

const VERSION = 1;

export function packSeries(s: Series): ArrayBuffer {
	const w = new Writer();
	w.int(VERSION);
	w.int(s.t.length);
	w.column(s.t.map((v) => Math.round(v * 100)));
	w.column(s.left.map((v) => Math.round(v * 100)));
	// Distance in hundredths of a tile; -1 for "no target".
	w.column(s.dist.map((v) => (v === null ? -1 : Math.round(v * 100))));
	w.column(s.chasing);
	w.column(s.px);
	w.column(s.py);
	return w.finish();
}

export function unpackSeries(data: ArrayBuffer): Series {
	const r = new Reader(data);
	const v = r.int();
	if (v !== VERSION) throw new Error(`unknown series version ${v}`);
	const n = r.int();
	return {
		t: r.column(n).map((x) => x / 100),
		left: r.column(n).map((x) => x / 100),
		dist: r.column(n).map((x) => (x < 0 ? null : x / 100)),
		chasing: r.column(n),
		px: r.column(n),
		py: r.column(n)
	};
}
