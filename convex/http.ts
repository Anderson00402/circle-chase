import { httpRouter } from 'convex/server';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { httpAction } from './_generated/server';

const http = httpRouter();

/** Download links: /export/trials.csv and /export/trials.json, same filters as `exports:trials`. */
for (const format of ['csv', 'json'] as const) {
	http.route({
		path: `/export/trials.${format}`,
		method: 'GET',
		handler: httpAction(async (ctx, req) => {
			const p = new URL(req.url).searchParams;
			const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
			const source = p.get('source');
			const mode = p.get('mode');
			const out = await ctx.runQuery(api.exports.trials, {
				format,
				source: source === 'bot' || source === 'all' || source === 'human' ? source : undefined,
				mode: mode === 'study' || mode === 'arcade' ? mode : undefined,
				cue: p.get('cue') ?? undefined,
				from: num('from'),
				to: num('to'),
				participantId: (p.get('participantId') ?? undefined) as Id<'participants'> | undefined
			});
			return new Response(out.body, {
				headers: {
					'content-type': `${out.contentType}; charset=utf-8`,
					'content-disposition': `attachment; filename="${out.filename}"`,
					'access-control-allow-origin': '*'
				}
			});
		})
	});
}

export default http;
