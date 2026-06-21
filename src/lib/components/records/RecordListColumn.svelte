<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import RecordFilterPanel, { type FilterRow } from '$lib/components/RecordFilterPanel.svelte';
	import RecordBulkActions from '$lib/components/RecordBulkActions.svelte';
	import EntityRowMenu from '$lib/components/entity-settings/EntityRowMenu.svelte';
	import { ListChecks, Plus, X, Filter, AlertTriangle } from 'lucide-svelte';
	import { fieldLabel, schemaUserFieldKeys } from '$lib/core/fieldKeys.js';
	import { recordListTitle, recordListSubtitle } from '$lib/core/recordDisplay.js';
	import type { JsonListItem, SchemaDefinition } from '$lib/core/types.js';

	/**
	 * The Records Explorer's middle column: the record list for the active type. Replaces the tile
	 * `DataGrid` with a name-forward scrollable list (records are text-first, not thumbnails). Owns the
	 * search/group/title/filter controls and the multiselect bulk bar; the host owns the data and the
	 * open record. Rows resolve their title via {@link recordListTitle} so types without a `name` field
	 * show something meaningful instead of a raw id.
	 *
	 * @param typeName - Display name of the active type (column header).
	 * @param typeId - The active type id (for bulk actions + schema editor wiring).
	 * @param schema - The type's schema (drives group/title/filter field lists).
	 * @param records - The records to show (already loaded by the host for the active filters/group).
	 * @param loading - Show a loading hint instead of the list.
	 * @param query / groupBy / filters - Bindable list controls (host reloads on change). "Title by" is
	 *   no longer here — it's a persisted per-type setting in the ⋮ → Settings dialog.
	 * @param selectionMode / selectedIds / selectedRecordId - Multiselect + active-row state.
	 * @param onOpen / onToggleSelect / onNewRecord / onToggleSelectionMode / onBulkChanged - Callbacks.
	 * @param onOpenSettings / onDeleteType - Open the active type's settings dialog / delete confirm
	 *   from the content-header ⋮ (always reachable, even when the rail is collapsed).
	 */
	let {
		typeName,
		typeId,
		schema,
		records,
		loading,
		groupBy = $bindable(''),
		filters = $bindable<FilterRow[]>([]),
		selectionMode,
		selectedIds,
		selectedRecordId,
		onOpen,
		onToggleSelect,
		onNewRecord,
		onToggleSelectionMode,
		onBulkChanged,
		onOpenSettings,
		onDeleteType
	}: {
		typeName: string;
		typeId: string;
		schema: SchemaDefinition | null;
		records: JsonListItem[];
		loading: boolean;
		groupBy?: string;
		filters?: FilterRow[];
		selectionMode: boolean;
		selectedIds: Set<string>;
		selectedRecordId: string | null;
		onOpen: (id: string) => void;
		onToggleSelect: (id: string) => void;
		onNewRecord: () => void;
		onToggleSelectionMode: () => void;
		onBulkChanged: () => void;
		onOpenSettings: () => void;
		onDeleteType: () => void;
	} = $props();

	/** Schema field keys eligible for group-by / title (name first). */
	const schemaFieldKeys = $derived(schema ? schemaUserFieldKeys(schema) : []);

	const activeFilterCount = $derived(
		filters.filter((r) => r.enabled !== false && r.field && r.operator).length
	);

	/** Records grouped by the server-provided `group_by_value`, or null when flat. */
	const groupedRecords = $derived.by<[string, JsonListItem[]][] | null>(() => {
		if (!groupBy) return null;
		const groups: Record<string, JsonListItem[]> = {};
		for (const item of records) {
			const v = item.group_by_value;
			const key =
				v == null || v === ''
					? '—'
					: Array.isArray(v)
						? v.length
							? v.join(', ')
							: '—'
						: String(v);
			(groups[key] ??= []).push(item);
		}
		return Object.entries(groups).sort((a, b) => {
			if (a[0] === '—') return -1;
			if (b[0] === '—') return 1;
			return a[0].localeCompare(b[0]);
		});
	});

	/**
	 * Subtitle for a row: the type's configured "subtitle by" field (resolved server-side into
	 * `subtitle_value`), independent of grouping. Group values live only in the sticky group headers.
	 */
	function rowSubtitle(item: JsonListItem): string | null {
		const s = recordListSubtitle(item);
		return s && s !== recordListTitle(item) ? s : null;
	}
</script>

<div class="flex h-screen min-w-0 flex-1 flex-col">
	<!-- Header: name + actions -->
	<header class="flex items-center gap-2 border-b p-3">
		<h1 class="truncate text-base font-semibold">{typeName}</h1>
		<span class="shrink-0 text-xs text-muted-foreground">
			{records.length} record{records.length === 1 ? '' : 's'}
		</span>
		<div class="flex-1"></div>
		<Button
			variant={selectionMode ? 'secondary' : 'ghost'}
			size="sm"
			onclick={onToggleSelectionMode}
			title={selectionMode ? 'Clear selection' : 'Select records'}
		>
			{#if selectionMode}
				<X class="size-4" /> Clear
			{:else}
				<ListChecks class="size-4" /> Select
			{/if}
		</Button>
		<Button size="sm" onclick={onNewRecord}>
			<Plus class="size-4" /> New
		</Button>
		<EntityRowMenu
			noun="record type"
			onSettings={onOpenSettings}
			onDelete={onDeleteType}
			triggerClass="size-8"
		/>
	</header>

	<!-- Controls: group / title / filter -->
	<div class="flex flex-wrap items-center gap-2 border-b p-2 text-sm">
		<div class="flex items-center gap-1.5">
			<span class="text-muted-foreground">Group</span>
			<Select.Root type="single" value={groupBy} onValueChange={(v) => (groupBy = v ?? '')}>
				<Select.Trigger class="h-8 w-32">{groupBy ? fieldLabel(groupBy) : 'None'}</Select.Trigger>
				<Select.Content>
					<Select.Item value="">None</Select.Item>
					{#each schemaFieldKeys as k (k)}
						<Select.Item value={k}>{fieldLabel(k)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						<Filter class="size-4" /> Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-80" align="start">
				<RecordFilterPanel {schema} bind:filters />
			</Popover.Content>
		</Popover.Root>
	</div>

	<!-- Bulk bar -->
	{#if selectionMode}
		<div class="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-2 text-sm">
			<RecordBulkActions
				{typeId}
				{schema}
				selectedIds={[...selectedIds]}
				onchanged={onBulkChanged}
			/>
			<Button variant="ghost" size="sm" class="ml-auto text-xs" onclick={onToggleSelectionMode}>
				clear
			</Button>
		</div>
	{/if}

	<!-- List -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if loading}
			<p class="p-4 text-sm text-muted-foreground">Loading…</p>
		{:else if records.length === 0}
			<div class="flex flex-col items-center gap-3 p-8 text-center text-sm text-muted-foreground">
				<p>No records found.</p>
				<Button size="sm" onclick={onNewRecord}><Plus class="size-4" /> New record</Button>
			</div>
		{:else}
			{#snippet row(item: JsonListItem)}
				{@const subtitle = rowSubtitle(item)}
				<div
					class="flex items-center gap-2 border-b px-2 py-1.5 hover:bg-muted/50 {item.id ===
					selectedRecordId
						? 'bg-muted'
						: ''}"
				>
					{#if selectionMode}
						<Checkbox
							checked={selectedIds.has(item.id)}
							onCheckedChange={() => onToggleSelect(item.id)}
							aria-label="Select record"
						/>
					{/if}
					<button
						type="button"
						class="flex min-w-0 flex-1 flex-col items-start text-left"
						onclick={() => onOpen(item.id)}
					>
						<span class="flex w-full min-w-0 items-center gap-1.5">
							<span class="min-w-0 flex-1 truncate text-sm">{recordListTitle(item)}</span>
							{#if item.missing_file_fields?.length}
								<AlertTriangle
									class="size-3.5 shrink-0 text-amber-500"
									aria-label="Missing file reference: {item.missing_file_fields.join(', ')}"
								/>
							{/if}
						</span>
						{#if subtitle}
							<span class="w-full min-w-0 truncate text-xs text-muted-foreground">{subtitle}</span>
						{/if}
					</button>
				</div>
			{/snippet}

			{#if groupedRecords}
				{#each groupedRecords as [groupKey, list] (groupKey)}
					<div
						class="sticky top-0 z-10 border-b bg-background/95 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur"
					>
						{fieldLabel(groupBy)}: {groupKey} ({list.length})
					</div>
					{#each list as item (item.id)}
						{@render row(item)}
					{/each}
				{/each}
			{:else}
				{#each records as item (item.id)}
					{@render row(item)}
				{/each}
			{/if}
		{/if}
	</div>
</div>
