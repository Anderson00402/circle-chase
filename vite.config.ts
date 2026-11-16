import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
});
