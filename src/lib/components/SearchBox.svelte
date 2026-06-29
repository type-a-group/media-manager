<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Search, X } from 'lucide-svelte';

	/**
	 * The single shared search input used by both sub-app rails (Files + Records). A thin shell over
	 * the shadcn {@link Input} that adds a leading search glyph and a clear (✕) affordance, so the two
	 * sides stop forking near-identical `<Input placeholder="Search…">` markup. Filtering semantics are
	 * the host's job — this only owns the text.
	 *
	 * @param value - Bindable query string.
	 * @param placeholder - Input placeholder (defaults to "Search…").
	 */
	let {
		value = $bindable(''),
		placeholder = 'Search…'
	}: {
		value?: string;
		placeholder?: string;
	} = $props();
</script>

<div class="relative">
	<Search
		class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
	/>
	<Input class="h-8 px-7 text-sm" {placeholder} bind:value />
	{#if value}
		<button
			type="button"
			aria-label="Clear search"
			class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
			onclick={() => (value = '')}
		>
			<X class="size-3.5" />
		</button>
	{/if}
</div>
