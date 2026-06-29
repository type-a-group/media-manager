<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowDownNarrowWide, ArrowUpNarrowWide } from 'lucide-svelte';
	import type { SortDir } from '$lib/core/sort.js';

	/**
	 * The shared list **sort control** (Item 9): a field `Select` + a direction toggle button. Used in
	 * the content toolbar of every list view (Records / single-class catalog / All Files) so sorting
	 * looks and behaves identically everywhere — don't fork per surface.
	 *
	 * The host owns persistence + re-querying: bind `field`/`dir` and react in an `$effect` (mirroring
	 * how `groupBy` already works), and use {@link onchange} to persist the chosen sort durably. The
	 * option list is host-supplied so each surface offers only the fields it actually has (built-ins +
	 * its schema fields).
	 *
	 * @param options - Selectable sort fields as `{ value, label }` (e.g. Name, Last modified, schema fields).
	 * @param field - Bindable selected sort key.
	 * @param dir - Bindable sort direction (`asc` | `desc`).
	 * @param onchange - Called after a user changes the field or direction (host persists + reloads).
	 */
	let {
		options,
		field = $bindable(''),
		dir = $bindable('desc'),
		onchange
	}: {
		options: { value: string; label: string }[];
		field?: string;
		dir?: SortDir;
		onchange?: () => void;
	} = $props();

	const currentLabel = $derived(options.find((o) => o.value === field)?.label ?? 'Sort');

	function setField(v: string | undefined) {
		field = v ?? '';
		onchange?.();
	}

	function toggleDir() {
		dir = dir === 'asc' ? 'desc' : 'asc';
		onchange?.();
	}
</script>

<div class="flex items-center gap-1.5">
	<span class="text-muted-foreground">Sort</span>
	<Select.Root type="single" value={field} onValueChange={setField}>
		<Select.Trigger class="h-8 w-36">{currentLabel}</Select.Trigger>
		<Select.Content>
			{#each options as o (o.value)}
				<Select.Item value={o.value}>{o.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
	<Button
		variant="outline"
		size="icon"
		class="size-8"
		onclick={toggleDir}
		title={dir === 'asc' ? 'Ascending' : 'Descending'}
		aria-label={dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
	>
		{#if dir === 'asc'}
			<ArrowUpNarrowWide class="size-4" />
		{:else}
			<ArrowDownNarrowWide class="size-4" />
		{/if}
	</Button>
</div>
