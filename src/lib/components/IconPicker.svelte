<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import EntityIcon from './EntityIcon.svelte';
	import { ICON_OPTIONS, type IconId } from '$lib/core/icons.js';
	import { Search, X } from 'lucide-svelte';

	/**
	 * The shared **icon picker** for per-entity icons (a Files class or a Records type), used by the
	 * General tab of {@link EntitySettingsDialog}. An avatar-style trigger button (showing the current
	 * icon, or the surface's generic `fallback` when unset) opens a searchable grid of the curated
	 * {@link ICON_OPTIONS}; picking one calls `onSelect(id)`, and "No icon" calls `onSelect(undefined)`
	 * to clear back to the fallback. The picker is presentation-only — it neither persists nor knows the
	 * entity; the host threads the chosen id into its existing save.
	 *
	 * @param value - The currently selected icon id (undefined ⇒ unset, trigger shows `fallback`).
	 * @param fallback - Generic glyph shown when `value` is unset (e.g. `tag` for classes).
	 * @param onSelect - Called with the new id, or `undefined` to clear.
	 * @param label - Accessible label / tooltip for the trigger (defaults to "Choose icon").
	 */
	let {
		value,
		fallback,
		onSelect,
		label = 'Choose icon'
	}: {
		value?: string;
		fallback: IconId;
		onSelect: (id: IconId | undefined) => void;
		label?: string;
	} = $props();

	let open = $state(false);
	let query = $state('');

	const filtered = $derived(
		query.trim()
			? ICON_OPTIONS.filter((o) => {
					const q = query.trim().toLowerCase();
					return o.label.toLowerCase().includes(q) || o.id.includes(q);
				})
			: ICON_OPTIONS
	);

	function choose(id: IconId | undefined) {
		onSelect(id);
		open = false;
		query = '';
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="outline"
				size="icon"
				class="size-9 shrink-0"
				title={label}
				aria-label={label}
			>
				<EntityIcon name={value} {fallback} class="size-5" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-64 space-y-2 p-2" align="start">
		<div class="relative">
			<Search
				class="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<!-- svelte-ignore a11y_autofocus -->
			<Input bind:value={query} placeholder="Search icons…" class="h-8 pl-7 text-sm" autofocus />
		</div>
		<div class="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
			{#each filtered as o (o.id)}
				<Button
					type="button"
					variant={value === o.id ? 'secondary' : 'ghost'}
					size="icon"
					class="size-8 {value === o.id ? 'ring-1 ring-primary' : ''}"
					title={o.label}
					aria-label={o.label}
					onclick={() => choose(o.id)}
				>
					<EntityIcon name={o.id} {fallback} class="size-4" />
				</Button>
			{/each}
			{#if filtered.length === 0}
				<p class="col-span-7 py-3 text-center text-xs text-muted-foreground">No icons match.</p>
			{/if}
		</div>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="w-full justify-start text-xs text-muted-foreground"
			onclick={() => choose(undefined)}
		>
			<X class="size-3.5" /> No icon
		</Button>
	</Popover.Content>
</Popover.Root>
