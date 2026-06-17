<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import GlobalsEditorPane from '$lib/components/GlobalsEditorPane.svelte';
	import RecordEditorPanel from '$lib/components/RecordEditorPanel.svelte';
	import RecordFilterPanel, { type FilterRow } from '$lib/components/RecordFilterPanel.svelte';
	import RecordBulkActions from '$lib/components/RecordBulkActions.svelte';
	import SchemaEditorButton from '$lib/components/SchemaEditorButton.svelte';
	import SettingsButton from '$lib/components/SettingsButton.svelte';
	import DataGrid from '$lib/components/data-grid/DataGrid.svelte';
	import type { GridItem, GridConfig, GridCallbacks } from '$lib/components/data-grid/types.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Home, Plus } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		apiGetMediaType,
		apiGetSchemaForType,
		apiListRecordsForType,
		apiCreateRecordForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { refreshTrigger, schemaRefreshTrigger } from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import { VALUE_LESS_OPERATORS } from '$lib/core/filters.js';
	import type { JsonListItem, SchemaDefinition } from '$lib/core/types.js';

	const typeId = $derived($page.params.typeId);

	let typeInfo = $state<{ id: string; displayName: string; kind: string } | null>(null);
	let loadingType = $state(true);
	let typeError = $state<string | null>(null);
	const isGlobals = $derived(typeInfo?.id === 'globals');

	// --- json record hub state ---------------------------------------------------------------
	let schema = $state<SchemaDefinition | null>(null);
	let records = $state<JsonListItem[]>([]);
	let loading = $state(true);
	let query = $state('');
	let filters = $state<FilterRow[]>([]);
	let groupBy = $state('');
	let gridSize = $state<'small' | 'medium' | 'large'>('medium');

	const selectedIds = new SvelteSet<string>();
	let selectedRecordId = $state<string | null>(null);
	/** Bumped to force the open editor panel to reload (e.g. after a schema change). */
	let editorRefresh = $state(0);

	/** Schema field keys eligible for group-by / display (name first). */
	const schemaFieldKeys = $derived(
		schema
			? Object.keys(schema)
					.filter((k) => isUserFieldKey(k) || k === 'name')
					.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)))
			: []
	);

	/** Display name for a record: name → group_by_value → short id. */
	function displayName(item: JsonListItem): string {
		const n = item.name?.trim();
		if (n) return n;
		if (item.group_by_value != null && item.group_by_value !== '')
			return String(item.group_by_value);
		return item.id.slice(0, 8);
	}

	const filteredRecords = $derived(
		query.trim()
			? records.filter((r) => displayName(r).toLowerCase().includes(query.toLowerCase().trim()))
			: records
	);

	/** Records grouped by the server-provided `group_by_value`, or null when flat. */
	const groupedRecords = $derived.by<[string | null, JsonListItem[]][] | null>(() => {
		if (!groupBy) return null;
		const groups: Record<string, JsonListItem[]> = {};
		for (const item of filteredRecords) {
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

	/** Map a record to a side-agnostic, name-forward grid item (no thumbnail). */
	function toGridItem(item: JsonListItem): GridItem {
		return {
			id: item.id,
			primaryLabel: displayName(item),
			chips: [],
			warning: item.missing_file_fields?.length
				? `Missing file reference: ${item.missing_file_fields.join(', ')}`
				: undefined
		};
	}

	const gridItems = $derived(filteredRecords.map(toGridItem));
	const groupedGridItems = $derived<[string | null, GridItem[]][] | null>(
		groupedRecords
			? groupedRecords.map(([k, list]) => [k, list.map(toGridItem)] as [string | null, GridItem[]])
			: null
	);

	/** Flat record order matching the grid (for prev/next in the panel). */
	const orderedIds = $derived(
		groupedRecords
			? groupedRecords.flatMap(([, list]) => list.map((i) => i.id))
			: filteredRecords.map((i) => i.id)
	);
	const editorIndex = $derived(selectedRecordId ? orderedIds.indexOf(selectedRecordId) : -1);

	function gotoRecord(delta: number) {
		const next = orderedIds[editorIndex + delta];
		if (next) selectedRecordId = next;
	}

	const gridConfig = $derived<GridConfig>({
		size: gridSize,
		variant: 'text',
		selectable: true,
		activeId: selectedRecordId,
		groupLabel: (k) => `${fieldLabel(groupBy)}: ${k}`,
		emptyText: 'No records.'
	});
	const gridCallbacks: GridCallbacks = {
		onOpen: (id) => (selectedRecordId = id),
		onToggleSelect: (id) => toggleSelect(id),
		isSelected: (id) => selectedIds.has(id)
	};

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
	}

	/** Build the API filter clauses from the enabled filter rows. */
	function apiFilters() {
		return filters
			.filter((row) => row.enabled !== false && row.field && row.operator)
			.map((row) => ({
				field: row.field,
				operator: row.operator,
				...(VALUE_LESS_OPERATORS.has(row.operator) ? {} : { value: row.value })
			}));
	}

	async function loadSchema() {
		if (!typeId || isGlobals) return;
		try {
			schema = await apiGetSchemaForType(typeId);
		} catch (e) {
			console.error(e);
		}
	}

	async function loadRecords() {
		if (!typeId || isGlobals) return;
		loading = true;
		try {
			const clauses = apiFilters();
			const data = await apiListRecordsForType(typeId, {
				...(clauses.length > 0 ? { filters: clauses } : {}),
				groupBy: groupBy || undefined
			});
			records = 'records' in data ? (data.records as JsonListItem[]) : [];
		} catch (e) {
			console.error(e);
			toast.error('Failed to load records');
		} finally {
			loading = false;
		}
	}

	function setSize(v: 'small' | 'medium' | 'large') {
		gridSize = v;
		settingsStore.updateSetting('gridSize', v);
	}

	async function createRecord() {
		if (!typeId || isGlobals) return;
		try {
			const created = await apiCreateRecordForType(typeId);
			await loadRecords();
			selectedRecordId = created.id;
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record');
		}
	}

	/** After a bulk update/delete: clear selection and reload. */
	async function afterBulk() {
		selectedIds.clear();
		await loadRecords();
	}

	// Load the media type, set the shared store (read by SchemaEditorButton), then its schema+records.
	$effect(() => {
		const id = typeId;
		if (!id) return;
		loadingType = true;
		typeError = null;
		selectedRecordId = null;
		selectedIds.clear();
		apiGetMediaType(id)
			.then(async (info) => {
				typeInfo = { id: info.id, displayName: info.displayName ?? info.id, kind: info.kind };
				currentMediaTypeStore.set({
					typeId: info.id,
					kind: info.kind,
					displayName: info.displayName
				});
				if (info.id !== 'globals') {
					await loadSchema();
					await loadRecords();
				}
			})
			.catch((e) => {
				typeError = (e as Error)?.message ?? 'Failed to load media type';
				currentMediaTypeStore.set(null);
			})
			.finally(() => {
				loadingType = false;
			});
	});

	// Reload when filters / group-by change.
	$effect(() => {
		filters;
		groupBy;
		if (typeInfo && !isGlobals) loadRecords();
	});

	// Keep the grid size in sync with the global settings store (live updates from Settings dialog).
	$effect(() => {
		const unsubscribe = settingsStore.subscribe((s) => {
			gridSize = s.gridSize;
		});
		return () => unsubscribe();
	});

	// The shared schema editor / record refresh triggers (fired by SchemaEditorButton).
	$effect(() => {
		let prev = 0;
		const unsub = refreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				if (typeInfo && !isGlobals) loadRecords();
			}
		});
		return unsub;
	});
	$effect(() => {
		let prev = 0;
		const unsub = schemaRefreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				if (typeInfo && !isGlobals) {
					loadSchema();
					loadRecords();
					editorRefresh++;
				}
			}
		});
		return unsub;
	});

	onMount(() => {
		settingsStore.fetchSettings();
		return () => currentMediaTypeStore.set(null);
	});
</script>

{#if loadingType}
	<div class="flex min-h-[50vh] items-center justify-center p-8">
		<p class="text-muted-foreground">Loading…</p>
	</div>
{:else if typeError}
	<div class="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
		<p class="text-destructive">{typeError}</p>
		<a href="/" class="text-primary underline">Back to overview</a>
	</div>
{:else if isGlobals}
	<div class="flex min-h-screen flex-col">
		<header class="sticky top-0 z-10 flex items-center gap-3 border-b bg-background p-3">
			<Button variant="ghost" size="icon" title="Home" href="/">
				<Home class="size-4" />
			</Button>
			<h1 class="text-base font-semibold">{typeInfo?.displayName}</h1>
			<div class="flex-1"></div>
			<SettingsButton />
		</header>
		<div class="min-h-0 flex-1">
			<GlobalsEditorPane />
		</div>
	</div>
{:else}
	<Sidebar.Provider>
		<Sidebar.Root collapsible="none" class="h-screen border-r">
			<Sidebar.Header class="gap-2">
				<div class="flex items-center justify-between">
					<span class="px-1 text-base font-semibold">{typeInfo?.displayName}</span>
					<Button variant="ghost" size="icon" title="Home" href="/">
						<Home class="size-4" />
					</Button>
				</div>
				<Input class="h-8 text-sm" placeholder="Search records…" bind:value={query} />
			</Sidebar.Header>
			<Sidebar.Content class="p-2">
				<RecordFilterPanel {schema} bind:filters />
			</Sidebar.Content>
		</Sidebar.Root>

		<main class="flex h-screen min-w-0 flex-1 flex-col">
			<header class="flex items-center gap-3 border-b p-3">
				<span class="text-sm text-muted-foreground">
					{filteredRecords.length} record{filteredRecords.length === 1 ? '' : 's'}
				</span>
				<div class="flex items-center gap-1.5 text-sm">
					<span class="text-muted-foreground">Group by</span>
					<Select.Root type="single" value={groupBy} onValueChange={(v) => (groupBy = v ?? '')}>
						<Select.Trigger class="h-8 w-36"
							>{groupBy ? fieldLabel(groupBy) : 'None'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							{#each schemaFieldKeys as k (k)}
								<Select.Item value={k}>{fieldLabel(k)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<span class="text-muted-foreground">Size</span>
					<Select.Root
						type="single"
						value={gridSize}
						onValueChange={(v) => setSize(v as 'small' | 'medium' | 'large')}
					>
						<Select.Trigger class="h-8 w-28">{gridSize}</Select.Trigger>
						<Select.Content>
							<Select.Item value="small">small</Select.Item>
							<Select.Item value="medium">medium</Select.Item>
							<Select.Item value="large">large</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex-1"></div>
				<SchemaEditorButton />
				<SettingsButton />
				<Button size="sm" onclick={createRecord}>
					<Plus class="size-4" /> New record
				</Button>
			</header>

			{#if selectedIds.size > 0}
				<div class="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-2 text-sm">
					<RecordBulkActions
						typeId={typeId!}
						{schema}
						selectedIds={[...selectedIds]}
						onchanged={afterBulk}
					/>
					<Button
						variant="ghost"
						size="sm"
						class="ml-auto text-xs"
						onclick={() => selectedIds.clear()}
					>
						clear
					</Button>
				</div>
			{/if}

			<div class="min-h-0 flex-1">
				{#if loading}
					<p class="p-4 text-muted-foreground">Loading…</p>
				{:else}
					<DataGrid
						items={gridItems}
						groups={groupedGridItems}
						config={gridConfig}
						callbacks={gridCallbacks}
					/>
				{/if}
			</div>
		</main>

		{#if selectedRecordId}
			<RecordEditorPanel
				typeId={typeId!}
				recordId={selectedRecordId}
				index={editorIndex}
				total={orderedIds.length}
				refresh={editorRefresh}
				onPrev={() => gotoRecord(-1)}
				onNext={() => gotoRecord(1)}
				onclose={() => (selectedRecordId = null)}
				onchanged={loadRecords}
				ondeleted={async () => {
					selectedRecordId = null;
					await loadRecords();
				}}
			/>
		{/if}
	</Sidebar.Provider>
{/if}
