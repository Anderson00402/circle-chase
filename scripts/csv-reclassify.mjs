#!/usr/bin/env node
// Can the classes be recomputed from the trials CSV alone? Downloads /export/trials.csv (or reads a
// file), re-derives outcome, inRates, gaveUpEarly, wasted and decision for every row of rules
// version 3 with its own copy of the rules (typed in from docs/STUDY.md "Outcome of a trial"; it
// imports nothing from the app), and reports how many agree with what is stored. It also reads the
// chase log cell back and checks it against the trial-level chase columns. Read only.
//   node scripts/csv-reclassify.mjs [--source bot] [--run <simRun>] [--file trials.csv] [--show 5]
// Exits non-zero if any row disagrees.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SITE = 'http://127.0.0.1:3211';

// ----- the rules, rules version 3 -----
const WARN = 3, TIMELY = [0.2, 2], CAUGHT_DIST = 5, OVERSTAY_DIST = 5, REACH_SPEED = 5.6;

function reachable(m) {
	return m.lastChaseEnd === 'turn' && m.turnLeft !== null && m.turnLeft > 0 && m.turnDist !== null && m.turnDist <= m.turnLeft * REACH_SPEED;
}
function gaveUp(m) {
	return m.endReason === 'expired' && !m.engaged && reachable(m) && m.turnLeft > TIMELY[1];
}
function outcome(m) {
	if (m.endReason !== 'expired') return 'interrupted';
	if (m.caught && m.endDist !== null && m.endDist <= CAUGHT_DIST) return 'caught';
	if (m.lastChaseEnd === null) return 'not-engaged';
	if (m.lastChaseEnd === 'eat') return m.engaged ? 'catch' : 'not-engaged';
	const stayed = m.lastChaseEnd === 'open' || (m.turnLeft !== null && m.turnLeft < TIMELY[0]);
	if (stayed) return m.chaseEndDist !== null && m.chaseEndDist <= OVERSTAY_DIST ? 'overstayed' : 'other';
	if (!reachable(m)) return m.engaged ? 'other' : 'not-engaged';
	return m.turnLeft <= TIMELY[1] ? 'timely-retreat' : 'early-retreat';
}
const inRates = (m) => m.endReason === 'expired' && m.afterCut !== 'quit' && (m.engaged || gaveUp(m));
const DECISIONS = new Set(['caught', 'overstayed', 'timely-retreat', 'early-retreat']);

// ----- CSV -----
function parseCsv(text) {
	const rows = [];
	let row = [], cell = '', q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
			else cell += c;
		} else if (c === '"') q = true;
		else if (c === ',') { row.push(cell); cell = ''; }
		else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
		else if (c !== '\r') cell += c;
	}
	if (cell || row.length) { row.push(cell); rows.push(row); }
	return rows;
}
const num = (s) => (s === '' ? null : Number(s));
const bool = (s) => s === 'true';
const str = (s) => (s === '' ? null : s);

let text;
const t0 = Date.now();
if (opt('file', null)) text = readFileSync(opt('file'), 'utf8');
else {
	const qs = new URLSearchParams({ source: opt('source', 'bot') });
	if (opt('run', null)) qs.set('run', opt('run'));
	text = await (await fetch(`${SITE}/export/trials.csv?${qs}`)).text();
}
const [header, ...lines] = parseCsv(text);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const need = ['endReason', 'caught', 'endDist', 'lastChaseEnd', 'engaged', 'turnLeft', 'turnDist', 'chaseEndDist', 'afterCut', 'rulesVersion',
	'outcome', 'inRates', 'gaveUpEarly', 'wasted', 'decision', 'chaseLog', 'chaseGain', 'chaseGhost', 'chases'];
const missing = need.filter((c) => !(c in col));
if (missing.length) { console.log(`FAIL the CSV lacks columns: ${missing.join(', ')}`); process.exit(1); }
console.log(`${lines.length} rows, ${header.length} columns, read in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

let v3 = 0, older = 0;
const disagree = { outcome: [], inRates: [], gaveUpEarly: [], wasted: [], decision: [], chaseLog: [] };
const byClass = {};
for (const r of lines) {
	const g = (c) => r[col[c]];
	if (g('rulesVersion') !== '3') { older++; continue; }
	v3++;
	const m = {
		endReason: g('endReason'), caught: bool(g('caught')), endDist: num(g('endDist')), lastChaseEnd: str(g('lastChaseEnd')),
		engaged: bool(g('engaged')), turnLeft: num(g('turnLeft')), turnDist: num(g('turnDist')), chaseEndDist: num(g('chaseEndDist')),
		afterCut: str(g('afterCut'))
	};
	const o = outcome(m), ir = inRates(m), gu = gaveUp(m);
	const stored = g('outcome');
	byClass[stored] ??= { n: 0, same: 0 };
	byClass[stored].n++;
	if (o === stored) byClass[stored].same++;
	else disagree.outcome.push({ id: g('trialId'), stored, mine: o, m });
	if (ir !== bool(g('inRates'))) disagree.inRates.push({ id: g('trialId'), stored: g('inRates'), mine: ir });
	if (gu !== bool(g('gaveUpEarly'))) disagree.gaveUpEarly.push({ id: g('trialId'), stored: g('gaveUpEarly'), mine: gu });
	const w = o === 'early-retreat' ? m.turnLeft : null;
	if (w !== num(g('wasted'))) disagree.wasted.push({ id: g('trialId'), stored: g('wasted'), mine: w });
	if ((ir && DECISIONS.has(o)) !== bool(g('decision'))) disagree.decision.push({ id: g('trialId'), stored: g('decision'), mine: ir && DECISIONS.has(o) });
	// The chase log cell reads back and agrees with the trial-level columns.
	const cell = g('chaseLog');
	const log = cell === '' ? [] : cell.split(';').map((c) => { const [ghost, from, at, left, dist, gain, end, endDist] = c.split(' '); return { ghost, from: +from, at: +at, left: +left, dist: +dist, gain: +gain, end, endDist: endDist === '-' ? null : +endDist }; });
	const okLog = log.length === Number(g('chases')) && log.every((c) => c.ghost && Number.isFinite(c.left) && ['turn', 'eat', 'open'].includes(c.end))
		&& (m.lastChaseEnd === null ? log.length === 0 : log.some((c) => c.ghost === g('chaseGhost') && c.end === m.lastChaseEnd));
	if (!okLog) disagree.chaseLog.push({ id: g('trialId'), cell, chases: g('chases'), ghost: g('chaseGhost'), end: m.lastChaseEnd });
}

const pct = (k, n) => (n ? `${((100 * k) / n).toFixed(2)}%` : '-');
console.log(`rules version 3: ${v3} rows (${older} older rows keep their class and are in no rate)`);
for (const [k, list] of Object.entries(disagree)) console.log(`${list.length ? 'FAIL' : 'PASS'} ${k}: ${v3 - list.length} of ${v3} agree (${pct(v3 - list.length, v3)})`);
console.log('per stored class:');
for (const [c, x] of Object.entries(byClass).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${c.padEnd(15)} ${x.same} / ${x.n}`);
const show = +opt('show', 5);
for (const [k, list] of Object.entries(disagree)) for (const d of list.slice(0, show)) console.log(`  ${k} differs: ${JSON.stringify(d)}`);
const bad = Object.values(disagree).reduce((a, l) => a + l.length, 0);
console.log(bad ? `${bad} disagreement(s)` : 'every stored class, eligibility, give-up flag, wasted power and decision flag recomputes from the CSV alone');
process.exit(bad ? 1 : 0);
