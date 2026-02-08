import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Node adapter enables a simple `node build` server, which is also convenient for CLI/npx packaging.
		adapter: adapter(),

		// This app is intended to run locally (often via CLI) and accepts multipart uploads.
		// SvelteKit's default CSRF origin check can reject uploads in some local setups
		// (e.g. when host/origin differ due to proxies or hostnames).
		csrf: {
			checkOrigin: false
		}
	}
};

export default config;
