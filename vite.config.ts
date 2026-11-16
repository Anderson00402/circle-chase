import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
// @ts-ignore: the project has no Node type definitions; this runs in Node when Vite loads the config.
import { execSync } from 'node:child_process';
import pkg from './package.json';

/**
 * The build identifier stored with every session and trial (`appVersion`): package version plus the
 * git commit, e.g. "0.0.1+e8606d3" for a build, "0.0.1+e8606d3.dev" from the dev server (whose code
 * may be ahead of the commit).
 */
function appBuild(command: string): string {
	const version = pkg.version;
	let commit = 'nogit';
	try { commit = (execSync as (cmd: string, o: object) => { toString(): string })('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
	return `${version}+${commit}${command === 'serve' ? '.dev' : ''}`;
}

export default defineConfig(({ command }) => ({
	define: { __APP_BUILD__: JSON.stringify(appBuild(command)) },
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The app is a single-page app: the game, Convex client and charts all run in the browser.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	// PUBLIC_CONVEX_URL is written to .env.local by `convex dev`.
	envPrefix: ['VITE_', 'PUBLIC_'],
	server: { port: 5173, strictPort: true },
	test: { include: ['src/**/*.test.ts', 'convex/**/*.test.ts'] }
}));
