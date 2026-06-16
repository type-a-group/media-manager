<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { FileText, TriangleAlert } from 'lucide-svelte';
	import { gridColMin, type GridItem, type GridConfig, type GridCallbacks } from './types.js';

	/**
	 * Shared presentational tile grid for both the files hub and the json record views. It owns no
	 * data-fetching or mutation: the host maps its rows to {@link GridItem}s, optionally pre-groups
	 * them, and injects toolbar/bulk controls via snippets. Grouping is host-side so the grid stays
	 * agnostic of how each side derives a group value.
	 *
	 * @param items - Flat, already-filtered/ordered items (used when `groups` is null).
	 * @param groups - Pre-grouped `[groupKey, items][]`; a null key renders an unlabelled section.
	 * @param config - Size, selectability, active highlight, group label fn, empty text.
	 * @param callbacks - onOpen / onToggleSelect / isSelected.
	 * @param toolbar - Optional snippet rendered in a sticky header (e.g. group-by/size selects).
	 * @param bulkBar - Optional snippet rendered in the sticky header (e.g. bulk actions).
	 */
	let {
		items = [],
		groups = null,
		config,
		callbacks,
		toolbar,
		bulkBar
	}: {
		items?: GridItem[];
		groups?: [string | null, GridItem[]][] | null;
		config: GridConfig;
		callbacks: GridCallbacks;
		toolbar?: Snippet;
		bulkBar?: Snippet;
	} = $props();

	/** Sections to render: explicit groups, or a single unlabelled section over `items`. */
	const sections = $derived<[string | null, GridItem[]][]>(groups ?? [[null, items]]);
	const total = $derived(sections.reduce((n, [, list]) => n + list.length, 0));
	const colMin = $derived(gridColMin(config.size));
	const gridStyle = $derived(`grid-template-columns: repeat(auto-fill, minmax(${colMin}px, 1fr))`);
</script>

{#snippet tile(item: GridItem)}
	{@const selected = callbacks.isSelected?.(item.id) ?? false}
	<Card.Root
		class="group relative cursor-pointer gap-0 overflow-hidden p-0 hover:ring-2 hover:ring-primary {config.activeId ===
		item.id
			? 'ring-2 ring-primary'
			: ''}"
		role="button"
		tabindex={0}
		onclick={() => callbacks.onOpen(item.id)}
		onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && callbacks.onOpen(item.id)}
	>
		{#if config.selectable}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="absolute left-1 top-1 z-10 rounded bg-background/80 p-0.5"
				onclick={(e) => e.stopPropagation()}
			>
				<Checkbox checked={selected} onCheckedChange={() => callbacks.onToggleSelect?.(item.id)} />
			</div>
		{/if}
		{#if item.warning}
			<div
				class="absolute right-1 top-1 z-10 rounded bg-background/80 p-0.5 text-amber-500 shadow-sm"
				title={item.warning}
			>
				<TriangleAlert class="size-4" />
			</div>
		{/if}
		<div class="flex aspect-square items-center justify-center bg-muted">
			{#if item.thumbnailUrl}
				<img
					src={item.thumbnailUrl}
					alt={item.primaryLabel}
					class="h-full w-full object-cover"
					loading="lazy"
				/>
			{:else}
				<FileText class="size-8 text-muted-foreground" />
			{/if}
		</div>
		<div class="p-1.5">
			<div class="truncate text-xs" title={item.primaryLabel}>{item.primaryLabel}</div>
			{#if item.chips.length > 0 || item.extraChips}
				<div class="mt-0.5 flex flex-wrap gap-0.5">
					{#each item.chips as chip (chip.label)}
						{#if chip.tone === 'muted'}
							<span class="text-[10px] text-muted-foreground">{chip.label}</span>
						{:else}
							<span class="rounded bg-secondary px-1 text-[10px] text-secondary-foreground"
								>{chip.label}</span
							>
						{/if}
					{/each}
					{#if item.extraChips}
						<span class="text-[10px] text-muted-foreground">+{item.extraChips}</span>
					{/if}
				</div>
			{/if}
		</div>
	</Card.Root>
{/snippet}

<div class="flex h-full w-full flex-col">
	{#if toolbar || bulkBar}
		<div
			class="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-background p-3 shrink-0"
		>
			{@render toolbar?.()}
			{@render bulkBar?.()}
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto p-4">
		{#if total === 0}
			<p class="text-muted-foreground">{config.emptyText ?? 'No items.'}</p>
		{:else}
			{#each sections as [groupKey, groupItems] (groupKey)}
				<div class="mb-5">
					{#if groupKey !== null}
						<h3 class="mb-2 text-sm font-semibold text-muted-foreground">
							{config.groupLabel ? config.groupLabel(groupKey) : groupKey}
							<span class="ml-1 font-normal">({groupItems.length})</span>
						</h3>
					{/if}
					<div class="grid gap-3" style={gridStyle}>
						{#each groupItems as item (item.id)}
							{@render tile(item)}
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
