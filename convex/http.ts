import { httpRouter } from 'convex/server';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';
import { PAGE_SIZE, fileName, type Kind } from './exports';
import type { Filter } from './lib/filters';

const http = httpRouter();

/** The shared filter from query parameters: source, mode, cue, from, to, participantId, sessionId, run, includePractice. */
function filterFrom(p: URLSearchParams): Filter {
	const num = (k: string) => (p.get(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
	const source = p.get('source');
	const mode = p.get('mode');
	// Rows that arrive while a long export is running are left out, so every page sees the same set.
	const to = Math.min(num('to') ?? Number.MAX_SAFE_INTEGER, Date.now());
	return {
		source: source === 'bot' || source === 'all' || source === 'human' ? source : undefined,
		mode: mode === 'study' || mode === 'arcade' ? mode : undefined,
		cue: p.get('cue') || undefined,
		from: num('from'),
		to,
		participantId: (p.get('participantId') || undefined) as Id<'participants'> | undefined,
		sessionId: (p.get('sessionId') || undefined) as Id<'sessions'> | undefined,
		run: p.get('run') || undefined,
		includePractice: p.get('includePractice') === 'true' || p.get('includePractice') === '1' ? true : undefined
	};
}

/**
 * Download links, streamed page by page so they work at any size:
 *   /export/trials.csv, /export/trials.json  (one row per trial; JSON adds the unpacked series)
 *   /export/ratings.csv, /export/ratings.json (block and session questionnaire answers)
 *   /export/blocks.csv, /export/blocks.json   (one row per run of a case, with pauses and its rating)
 * Same filter as the read queries, as query parameters; `pageSize` (1-1000) forces smaller pages.
 */
const ROUTES: [Kind, 'csv' | 'json'][] = [['trials', 'csv'], ['trials', 'json'], ['ratings', 'csv'], ['ratings', 'json'], ['blocks', 'csv'], ['blocks', 'json']];
for (const [kind, format] of ROUTES) {
	http.route({
		path: `/export/${kind}.${format}`,
		method: 'GET',
		handler: httpAction(async (ctx, req) => {
			const p = new URL(req.url).searchParams;
			const f = filterFrom(p);
			const asked = Number(p.get('pageSize'));
			const size = asked >= 1 && asked <= 1000
				? Math.floor(asked)
				: kind === 'trials' ? (format === 'json' ? PAGE_SIZE.trialsJson : PAGE_SIZE.trials) : PAGE_SIZE[kind];
			const enc = new TextEncoder();
			let cursor: string | null = null;
			let first = true, rows = 0, done = false;
			const stream = new ReadableStream<Uint8Array>({
				async pull(out) {
					try {
						// Keep reading pages until one has something to send or the export is done. A page
						// may match no row at all (human rows among thousands of simulated ones); returning
						// without enqueuing would leave the stream waiting forever, since it only asks
						// again after a chunk was read.
						let text = '';
						while (!text && !done) {
							const page = await ctx.runQuery(api.exports.page, { ...f, kind, format, paginationOpts: { numItems: size, cursor } });
							if (format === 'csv') {
								if (first && page.header) text += page.header + '\n';
								for (const line of page.rows as string[]) text += line + '\n';
							} else {
								if (first) text += '[';
								for (const row of page.rows) text += (rows++ > 0 ? ',\n' : '') + JSON.stringify(row);
								if (page.isDone) text += ']\n';
							}
							first = false;
							cursor = page.continueCursor;
							if (page.isDone) done = true;
						}
						if (text) out.enqueue(enc.encode(text));
						if (done) out.close();
					} catch (err) {
						// Headers are already sent: end the file with a line that says it is incomplete.
						done = true;
						out.enqueue(enc.encode(format === 'csv' ? `\nEXPORT FAILED: ${String(err)}\n` : `\n"EXPORT FAILED: ${String(err).replace(/"/g, "'")}"\n`));
						out.close();
					}
				}
			});
			return new Response(stream, {
				headers: {
					'content-type': `${format === 'csv' ? 'text/csv' : 'application/json'}; charset=utf-8`,
					'content-disposition': `attachment; filename="${fileName(kind, format, f)}"`,
					'access-control-allow-origin': '*',
					'cache-control': 'no-store'
				}
			});
		})
	});
}

export default http;
