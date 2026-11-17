/**
 * The build identifier of the code actually being served, read by the telemetry client at page
 * load (src/lib/telemetry/write.ts `loadAppVersion`). Under the dev server it runs on every request,
 * so it names the commit checked out now, not the one the server started on; a static build
 * prerenders it once, with the commit it was built from.
 */
// @ts-ignore: the project has no Node type definitions; this runs in Node (dev server, prerender).
import { execSync } from 'node:child_process';
import pkg from '../../../package.json';

export const prerender = true;

export function GET(): Response {
	let commit = 'nogit';
	try {
		commit = (execSync as (cmd: string, o: object) => { toString(): string })('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch { /* not a checkout */ }
	const build = `${pkg.version}+${commit}${import.meta.env.DEV ? '.dev' : ''}`;
	return new Response(JSON.stringify({ build }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
