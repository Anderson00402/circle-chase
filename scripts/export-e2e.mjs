#!/usr/bin/env node
// Every download, through the real HTTP route of the running local deployment (:3211), for every
// combination that matters: trials / ratings / blocks, CSV and JSON, source human and bot, with and
// without a simulator run filter, with very small pages, and with filters that match nothing.
// Each must finish within a time limit, end cleanly (no "EXPORT FAILED"), parse (every CSV row has
// the header's column count, JSON is one array), and hold the same rows as:
//   - the same file with tiny pages (paging cannot drop or repeat rows),
//   - the other format (CSV rows = JSON rows),
//   - `exports.page` read directly from Node with big pages (the stream adds nothing, loses nothing),
//   - for unfiltered trials, the running counters (`live.counters`).
// Every request carries the same `to`, so rows arriving meanwhile (another agent playing) do not move
// the counts. Read only; adds and deletes nothing.
//   node scripts/export-e2e.mjs [--quick] [--run <simRun>] [--limit-s 180] [--squeeze <rows>]
// --quick skips the unfiltered bot files (tens of MB). --squeeze N makes every page above N rows
// fail on the server the way a busy machine does ("too many system operations"), so every download
// must get through by the stream's retry at half the page size. Needs Convex (:3210, :3211).
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const QUICK = args.includes('--quick');
const LIMIT_S = +opt('limit-s', 180);
const SQUEEZE = opt('squeeze', null);
const CONVEX = 'http://127.0.0.1:3210', SITE = 'http://127.0.0.1:3211';
const http = new ConvexHttpClient(CONVEX);
const TO = Date.now();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };

/** Rows of a CSV text: quoted cells may hold commas, quotes and line breaks. */
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

/** Download one file; returns { rows, header, seconds, bytes, error }. */
async function download(file, params) {
	const qs = new URLSearchParams({ to: String(TO), ...params, ...(SQUEEZE ? { simulateLimit: SQUEEZE } : {}) });
	const t0 = Date.now();
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), LIMIT_S * 1000);
	try {
		const res = await fetch(`${SITE}/export/${file}?${qs}`, { signal: ctl.signal });
		const text = await res.text();
		const seconds = (Date.now() - t0) / 1000;
		if (res.status !== 200) return { error: `HTTP ${res.status}: ${text.slice(0, 200)}`, seconds };
		if (text.includes('EXPORT FAILED')) return { error: text.slice(text.indexOf('EXPORT FAILED'), text.indexOf('EXPORT FAILED') + 200), seconds };
		if (file.endsWith('.json')) {
			const data = JSON.parse(text);
			if (!Array.isArray(data)) return { error: 'not an array', seconds };
			return { rows: data.length, seconds, bytes: text.length, ids: data.map((r) => r._id ?? r.ratingId ?? r.blockId) };
		}
		const rows = parseCsv(text);
		const header = rows[0] ?? [];
		const bad = rows.slice(1).filter((r) => r.length !== header.length).length;
		if (bad) return { error: `${bad} rows do not have the header's ${header.length} columns`, seconds };
		const idCol = header.indexOf(file.startsWith('trials') ? 'trialId' : file.startsWith('ratings') ? 'ratingId' : 'blockId');
		return { rows: rows.length - 1, header, seconds, bytes: text.length, ids: rows.slice(1).map((r) => r[idCol]) };
	} catch (e) {
		return { error: ctl.signal.aborted ? `did not finish within ${LIMIT_S} s (stalled?)` : String(e), seconds: (Date.now() - t0) / 1000 };
	} finally {
		clearTimeout(timer);
	}
}

/** The same rows read straight from the query (no HTTP stream); a failed page is read again smaller. */
async function direct(kind, params) {
	const f = { to: TO, ...params };
	for (const k of ['from', 'to']) if (f[k] !== undefined) f[k] = Number(f[k]);
	delete f.pageSize;
	let cursor = null, n = 0, size = 200;
	for (;;) {
		let p;
		for (let attempt = 0; ; attempt++) {
			try {
				p = await http.query(api.exports.page, { ...f, kind, format: 'json', paginationOpts: { numItems: size, cursor } });
				break;
			} catch (e) {
				if (attempt >= 6) throw e;
				size = Math.max(1, Math.floor(size / 2));
			}
		}
		n += p.rows.length;
		if (p.isDone) return n;
		cursor = p.continueCursor;
	}
}

const sameIds = (a, b) => a && b && a.length === b.length && new Set(a).size === a.length && a.every((x, i) => x === b[i]);
const fmt = (d) => d.error ? `ERROR ${d.error} after ${d.seconds.toFixed(1)} s` : `${d.rows} rows, ${(d.bytes / 1e6).toFixed(2)} MB, ${d.seconds.toFixed(2)} s`;

// A simulator run to filter on: the one asked for, else the newest complete run (the dashboard's list).
async function pickRun() {
	try {
		const f = await http.query(api.dashboard.facets, { source: 'bot', now: TO });
		return f.runs.find((r) => r.complete)?.run ?? f.runs[0]?.run ?? null;
	} catch {
		return (await http.query(api.trials.list, { source: 'bot', paginationOpts: { numItems: 50, cursor: null } })).page.find((t) => t.simRun)?.simRun ?? null;
	}
}
const runId = opt('run', null) ?? (await pickRun());
console.log(`filters up to ${new Date(TO).toISOString()}; simulator run ${runId ?? '(none found)'}${QUICK ? '; quick' : ''}${SQUEEZE ? `; pages above ${SQUEEZE} rows fail on purpose` : ''}`);

const cases = [];
for (const kind of ['trials', 'ratings', 'blocks']) {
	cases.push({ kind, name: 'human', params: { source: 'human' }, tiny: 1 });
	if (!QUICK) cases.push({ kind, name: 'bot, everything', params: { source: 'bot' }, tiny: kind === 'trials' ? 0 : 5 });
	if (runId) cases.push({ kind, name: `bot, run ${runId}`, params: { source: 'bot', run: runId }, tiny: kind === 'trials' ? 25 : 2 });
	if (runId) cases.push({ kind, name: 'human, a simulator run (matches nothing)', params: { source: 'human', run: runId }, tiny: 1, none: true });
	cases.push({ kind, name: 'bot, a cue that does not exist', params: { source: 'bot', cue: 'no-such-cue' }, tiny: 1, none: true });
	cases.push({ kind, name: 'bot, a time range in the past with nothing in it', params: { source: 'bot', from: '1', to: '2' }, tiny: 1, none: true });
}

const timings = [];
for (const c of cases) {
	console.log(`\n${c.kind}: ${c.name}`);
	const csv = await download(`${c.kind}.csv`, c.params);
	const json = await download(`${c.kind}.json`, c.params);
	console.log(`  csv  ${fmt(csv)}\n  json ${fmt(json)}`);
	timings.push({ file: `${c.kind}.csv`, name: c.name, ...csv }, { file: `${c.kind}.json`, name: c.name, ...json });
	check(!csv.error, `${c.kind}.csv (${c.name}) finishes cleanly${csv.error ? ': ' + csv.error : ''}`);
	check(!json.error, `${c.kind}.json (${c.name}) finishes cleanly${json.error ? ': ' + json.error : ''}`);
	if (csv.error || json.error) continue;
	check(csv.rows === json.rows && sameIds(csv.ids, json.ids), `${c.kind} (${c.name}): CSV and JSON hold the same rows (${csv.rows} / ${json.rows})`);
	check(csv.header.length > 5, `${c.kind}.csv (${c.name}) has a header with every column (${csv.header.length})`);
	if (c.none) check(csv.rows === 0, `${c.kind} (${c.name}) is empty`);
	else {
		const n = await direct(c.kind, c.params);
		check(csv.rows === n, `${c.kind} (${c.name}): the download holds every row of the query (${csv.rows} = ${n})`);
	}
	if (c.tiny) {
		const small = await download(`${c.kind}.csv`, { ...c.params, pageSize: String(c.tiny) });
		console.log(`  csv, pages of ${c.tiny}: ${fmt(small)}`);
		timings.push({ file: `${c.kind}.csv pageSize=${c.tiny}`, name: c.name, ...small });
		check(!small.error && sameIds(small.ids, csv.ids), `${c.kind}.csv (${c.name}) in pages of ${c.tiny} holds the same rows${small.error ? ': ' + small.error : ` (${small.rows})`}`);
		if (c.kind !== 'trials' || c.tiny <= 25) {
			const smallJson = await download(`${c.kind}.json`, { ...c.params, pageSize: String(c.tiny) });
			check(!smallJson.error && sameIds(smallJson.ids, json.ids), `${c.kind}.json (${c.name}) in pages of ${c.tiny} holds the same rows${smallJson.error ? ': ' + smallJson.error : ` (${smallJson.rows})`}`);
		}
	}
	if (c.kind === 'trials' && !c.params.run && !c.params.cue && !c.params.from) {
		const counters = await http.query(api.live.counters, { source: c.params.source, now: TO });
		if (counters.lastTrialAt === null || counters.lastTrialAt <= TO) check(csv.rows === counters.trials, `trials (${c.name}): the download holds as many trials as the counters (${csv.rows} = ${counters.trials})`);
		else console.log(`  (counters moved on since the start: ${counters.trials}, not compared)`);
	}
}

console.log('\nslowest downloads:');
for (const t of timings.filter((x) => !x.error).sort((a, b) => b.seconds - a.seconds).slice(0, 6)) console.log(`  ${t.file.padEnd(26)} ${t.name.padEnd(42)} ${fmt(t)}`);
console.log(failed ? `${failed} export check(s) failed` : 'all export checks passed');
process.exit(failed ? 1 : 0);
