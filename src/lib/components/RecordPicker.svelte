<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Search, FileText, X, ExternalLink, Plus } from 'lucide-svelte';
	import { apiListRecordsForType } from '$lib/api/client.js';
	import { recordListTitle } from '$lib/core/recordDisplay.js';
	import { refreshTrigger } from '$lib/stores/refreshTrigger.js';
	import type { JsonListItem } from '$lib/core/types.js';

	/**
	 * The records counterpart of {@link FilePicker}: pick one (or, when `multiselect`, several) record(s)
	 * from a single configured json record type. Stores the referenced record's stable `id`; the trigger
	 * resolves it to the type's display title (via {@link recordListTitle}) and links through to the
	 * record's editor at `/media/<recordType>?record=<id>`.
	 *
	 * The picker scopes its search to `recordType` only — never all records — mirroring how a `record`
	 * schema field is configured. Titles are resolved client-side from the loaded list (the list API
	 * returns every record, so an already-selected id always resolves), exactly as FilePicker resolves
	 * filenames.
	 *
	 * @param recordType - The target json type id (`records/<recordType>`) this field references.
	 * @param value - Two-way bound: a record id `string` (single) or `string[]` (multiselect).
	 * @param multiselect - When true, `value` is an id array and multiple records may be chosen.
	 * @param onSelect - Called with the new value after every add/remove (host autosaves).
	 */
	let {
		recordType,
		value = $bindable(),
		multiselect = false,
		onSelect
	}: {
		recordType: string;
		value?: string | string[];
		multiselect?: boolean;
		onSelect?: (value: string | string[]) => void;
	} = $props();

	let open = $state(false);
	let records = $state<JsonListItem[]>([]);
	let loading = $state(false);
	let query = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Currently-selected ids, normalized to an array regardless of cardinality. */
	const selectedIds = $derived<string[]>(
		multiselect ? (Array.isArray(value) ? (value as string[]) : []) : value ? [value as string] : []
	);

	/** Resolve a record id to its display title from the loaded list (falls back to a short id). */
	function titleFor(id: string): string {
		const item = records.find((r) => r.id === id);
		return item ? recordListTitle(item) : id.slice(0, 8);
	}

	/** Deep link to a referenced record's editor in the Records sub-app. */
	function recordHref(id: string): string {
		return `/media/${encodeURIComponent(recordType)}?record=${encodeURIComponent(id)}`;
	}

	/** Load records of the target type, honouring the current search query. */
	async function fetchRecords() {
		if (!recordType) return;
		loading = true;
		try {
			const res = await apiListRecordsForType(recordType, { searchQuery: query || undefined });
			records = res.records;
		} catch (e) {
			console.error('RecordPicker: failed to fetch records', e);
		} finally {
			loading = false;
		}
	}

	function handleSearchInput(e: Event) {
		query = (e.target as HTMLInputElement).value;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => fetchRecords(), 300);
	}

	$effect(() => {
		if (open) fetchRecords();
	});

	// Resolve already-selected ids to titles even before the dialog is first opened.
	$effect(() => {
		if (selectedIds.length > 0 && records.length === 0 && !loading) fetchRecords();
	});

	// The cached `records` list backs the collapsed trigger's title. When a referenced record's title
	// changes elsewhere (which bumps `refreshTrigger`), refresh the cache so a closed picker doesn't keep
	// a stale title until reopened. Skips the initial value (no-op on mount).
	let lastRefresh = $state(0);
	$effect(() => {
		const n = $refreshTrigger;
		if (n !== lastRefresh) {
			lastRefresh = n;
			if (selectedIds.length > 0) fetchRecords();
		}
	});

	function commit(next: string | string[]) {
		value = next;
		onSelect?.(next);
	}

	function handleSelect(item: JsonListItem) {
		if (multiselect) {
			if (!selectedIds.includes(item.id)) commit([...selectedIds, item.id]);
		} else {
			commit(item.id);
			open = false;
		}
	}

	function removeId(id: string) {
		if (multiselect) {
			commit(selectedIds.filter((x) => x !== id));
		} else {
			commit('');
		}
	}
</script>

{#snippet refChip(id: string)}
	<span
		class="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-sm"
		title={titleFor(id)}
	>
		<FileText class="size-3.5 shrink-0 text-muted-foreground" />
		<span class="truncate">{titleFor(id)}</span>
		<a
			href={recordHref(id)}
			class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
			aria-label="Open record"
			title="Open record"
		>
			<ExternalLink class="size-3.5" />
		</a>
		<button
			type="button"
			class="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
			onclick={() => removeId(id)}
			aria-label="Remove reference"
		>
			<X class="size-3.5" />
		</button>
	</span>
{/snippet}

<div class="flex w-full flex-col gap-2">
	{#if multiselect}
		{#if selectedIds.length > 0}
			<div class="flex flex-wrap gap-1.5">
				{#each selectedIds as id (id)}
					{@render refChip(id)}
				{/each}
			</div>
		{/if}
		<Dialog.Root bind:open>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" class="w-fit gap-1.5">
						<Plus class="size-4" /> Add record…
					</Button>
				{/snippet}
			</Dialog.Trigger>
			{@render pickerContent()}
		</Dialog.Root>
	{:else}
		<div class="flex items-center gap-2">
			<Dialog.Root bind:open>
				<Dialog.Trigger class="min-w-0 flex-1">
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							class="h-auto w-full min-w-0 flex-1 justify-start gap-2 py-1.5 text-left font-normal"
						>
							{#if selectedIds.length > 0}
								<FileText class="size-5 shrink-0 text-muted-foreground" />
								<span class="flex-1 truncate">{titleFor(selectedIds[0])}</span>
							{:else}
								<span class="text-muted-foreground">Select record…</span>
							{/if}
						</Button>
					{/snippet}
				</Dialog.Trigger>
				{@render pickerContent()}
			</Dialog.Root>
			{#if selectedIds.length > 0}
				<a
					href={recordHref(selectedIds[0])}
					class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Open record"
					title="Open record"
				>
					<ExternalLink class="size-4" />
				</a>
				<button
					type="button"
					class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={() => removeId(selectedIds[0])}
					aria-label="Clear record selection"
				>
					<X class="size-4" />
				</button>
			{/if}
		</div>
	{/if}
</div>

{#snippet pickerContent()}
	<Dialog.Content class="flex max-h-[80vh] max-w-2xl flex-col">
		<Dialog.Title>Select Record</Dialog.Title>
		<Dialog.Description>Search and select a record to reference.</Dialog.Description>
		<div class="mt-4 flex items-center gap-2">
			<Search class="size-4 shrink-0 text-muted-foreground" />
			<Input
				type="search"
				placeholder="Search records…"
				value={query}
				oninput={handleSearchInput}
			/>
		</div>
		<div
			class="mt-4 flex min-h-[16rem] flex-1 flex-col gap-1 overflow-y-auto rounded-md border p-2"
		>
			{#if loading}
				<div class="flex justify-center py-8 text-muted-foreground">Loading…</div>
			{:else if records.length === 0}
				<div class="flex justify-center py-8 text-muted-foreground">
					{query ? 'No records match your search.' : 'No records found.'}
				</div>
			{:else}
				{#each records as record (record.id)}
					{@const isSelected = selectedIds.includes(record.id)}
					<button
						class="flex items-center gap-2 rounded-md border p-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring {isSelected
							? 'bg-accent/50 ring-1 ring-primary'
							: ''}"
						onclick={() => handleSelect(record)}
					>
						<FileText class="size-4 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">{recordListTitle(record)}</span>
						{#if record.subtitle_value}
							<span class="shrink-0 truncate text-xs text-muted-foreground"
								>{record.subtitle_value}</span
							>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
{/snippet}
