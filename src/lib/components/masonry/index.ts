/**
 * Public entry point for the standalone masonry layout. Kept as a thin barrel so the directory can be
 * lifted into its own publishable package (`@nicbat/svelte-masonry` or similar) without touching call
 * sites — they import `Masonry` from here, never the `.svelte` file directly.
 */
export { default as Masonry } from './Masonry.svelte';
