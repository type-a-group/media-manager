<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import { goto } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import RecordsRail from '$lib/components/records/RecordsRail.svelte';
	import RecordListColumn from '$lib/components/records/RecordListColumn.svelte';
	import RecordDetailPane from '$lib/components/records/RecordDetailPane.svelte';
	import GlobalsEditorPane from '$lib/components/GlobalsEditorPane.svelte';
	import EntitySettingsDialog from '$lib/components/entity-settings/EntitySettingsDialog.svelte';
	import { typeSettingsAdapter } from '$lib/components/entity-settings/adapters.js';
	import { type FilterRow } from '$lib/components/RecordFilterPanel.svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { FolderOpen } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		apiListMediaTypes,
		apiGetSchemaForType,
		apiGetTypeSettings,
		apiListRecordsForType,
		apiCreateRecordForType,
		apiCreateMediaType,
		apiDeleteMediaType,
		type MediaTypeSummary
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { refreshTrigger, schemaRefreshTrigger } from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';
	import { isUserFieldKey, schemaUserFields } from '$lib/core/fieldKeys.js';
	import { VALUE_LESS_OPERATORS } from '$lib/core/filters.js';
	import type { JsonListItem, SchemaDefinition } from '$lib/core/types.js';

	/**
	 * The **Records Explorer** — the records sub-app's home. A persistent three-pane layout: a
	 * collapsible type rail (cross-cutting navigator), a record-list column for the active type, and an
	 * inline autosaving detail pane. There is deliberately no "All Records" merged view (records aren't
	 * attached to blobs the way files are; a record type is the records-side analogue of a class). The
	 * active type is held in `?type=<id>` (in-page selection — deep per-record routing is deferred). The
	 * reserved `globals` singleton renders its bespoke editor in place of the list+detail split.
	 */

	let types = $state<MediaTypeSummary[]>([]);
	let activeTypeId = $state<string | null>(null);
	let railCollapsed = $state(false);
	let loadingTypes = $state(true);

	let schema = $state<SchemaDefinition | null>(null);
	let records = $state<JsonListItem[]>([]);
	let loading = $state(true);
	let query = $state('');
	/** Field to scope the search to (`''` = All fields). Lives in the rail, like the Files hub. */
	let searchField = $state('');
	let filters = $state<FilterRow[]>([]);
	let groupBy = $state('');
	let titleField = $state('');
	let subtitleField = $state('');

	/** User fields of the active type offered by the rail's search-field picker. */
	const searchFields = $derived(schema ? schemaUserFields(schema) : []);

	// Drop a stale scoped search field if it's no longer in the active type's schema.
	$effect(() => {
		if (searchField && !searchFields.some((f) => f.key === searchField)) searchField = '';
	});

	const selectedIds = new SvelteSet<string>();
	let selectionMode = $state(false);
	let selectedRecordId = $state<string | null>(null);
	let editorRefresh = $state(0);

	// New-type dialog (shared with the dashboard flow).
	let newTypeOpen = $state(false);
	let newTypeName = $state('');

	// Unified per-type settings dialog (⋮ → Settings) + delete confirm.
	let settingsOpen = $state(false);
	let settingsTargetId = $state<string | null>(null);
	let deleteOpen = $state(false);
	let deleteTargetId = $state<string | null>(null);
	const settingsTargetName = $derived(
		types.find((t) => t.id === settingsTargetId)?.displayName ?? settingsTargetId ?? ''
	);
	const deleteTargetName = $derived(
		types.find((t) => t.id === deleteTargetId)?.displayName ?? deleteTargetId ?? ''
	);

	const isGlobals = $derived(activeTypeId === 'globals');
	const activeType = $derived(types.find((t) => t.id === activeTypeId) ?? null);
	const typeName = $derived(activeType?.displayName ?? activeTypeId ?? '');

	/**
	 * The visible record order (grouped) — drives prev/next in the detail pane. Search is now applied
	 * server-side (the list is already filtered), so this only mirrors the group ordering.
	 */
	const orderedIds = $derived.by<string[]>(() => {
		const filtered = records;
		if (!groupBy) return filtered.map((r) => r.id);
		const groups: Record<string, JsonListItem[]> = {};
		for (const item of filtered) {
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
		return Object.entries(groups)
			.sort((a, b) => (a[0] === '—' ? -1 : b[0] === '—' ? 1 : a[0].localeCompare(b[0])))
			.flatMap(([, list]) => list.map((i) => i.id));
	});
	const editorIndex = $derived(selectedRecordId ? orderedIds.indexOf(selectedRecordId) : -1);

	function gotoRecord(delta: number) {
		const next = orderedIds[editorIndex + delta];
		if (next) selectedRecordId = next;
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
		if (!activeTypeId || isGlobals) return;
		try {
			const [s, settings] = await Promise.all([
				apiGetSchemaForType(activeTypeId),
				apiGetTypeSettings(activeTypeId).catch(() => ({ displayField: '', subtitleField: '' }))
			]);
			schema = s;
			// The persisted subtitle field (⋮ → Settings → General) is sticky like the title field.
			subtitleField = settings.subtitleField || '';
			// The persisted "title by" (settings.displayField, set in the ⋮ → Settings dialog) wins and
			// makes the choice sticky across type switches. Otherwise fix the id-instead-of-title bug out
			// of the box: when a type has no `name` field, auto-pick a sensible field (first string, else
			// first user field).
			if (settings.displayField) {
				titleField = settings.displayField;
			} else if (!titleField && schema && !('name' in schema)) {
				const keys = Object.keys(schema).filter((k) => isUserFieldKey(k));
				const firstString = keys.find((k) => schema?.[k]?.type === 'string');
				titleField = firstString ?? keys[0] ?? '';
			}
		} catch (e) {
			console.error(e);
		}
	}

	async function loadRecords() {
		if (!activeTypeId || isGlobals) return;
		loading = true;
		try {
			const clauses = apiFilters();
			const data = await apiListRecordsForType(activeTypeId, {
				...(clauses.length > 0 ? { filters: clauses } : {}),
				groupBy: groupBy || undefined,
				titleField: titleField || undefined,
				subtitleField: subtitleField || undefined,
				searchQuery: query || undefined,
				searchField: searchField || undefined
			});
			records = 'records' in data ? (data.records as JsonListItem[]) : [];
		} catch (e) {
			console.error(e);
			toast.error('Failed to load records');
		} finally {
			loading = false;
		}
	}

	/** Switch the active type, syncing the URL and resetting per-type view state. */
	function selectType(id: string) {
		if (id === activeTypeId) return;
		activeTypeId = id;
		selectedRecordId = null;
		selectedIds.clear();
		selectionMode = false;
		query = '';
		searchField = '';
		filters = [];
		groupBy = '';
		titleField = '';
		subtitleField = '';
		try {
			replaceState(`/media?type=${encodeURIComponent(id)}`, {});
		} catch {
			/* router not ready (initial mount) — URL already correct */
		}
	}

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
	}

	function toggleSelectionMode() {
		selectedIds.clear();
		if (selectionMode) {
			selectionMode = false;
		} else {
			selectedRecordId = null;
			selectionMode = true;
		}
	}

	async function createRecord() {
		if (!activeTypeId || isGlobals) return;
		try {
			const created = await apiCreateRecordForType(activeTypeId);
			await loadRecords();
			selectedRecordId = created.id;
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record');
		}
	}

	async function createRecordType() {
		const name = newTypeName.trim();
		if (!name) return;
		try {
			const created = await apiCreateMediaType({ displayName: name, kind: 'json' });
			newTypeName = '';
			newTypeOpen = false;
			types = await apiListMediaTypes().catch(() => types);
			selectType(created.id);
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record type');
		}
	}

	function toggleRail() {
		railCollapsed = !railCollapsed;
		settingsStore.updateSetting('railCollapsed', railCollapsed);
	}

	function openTypeSettings(id: string) {
		settingsTargetId = id;
		settingsOpen = true;
	}

	function askDeleteType(id: string) {
		deleteTargetId = id;
		deleteOpen = true;
	}

	/** After a rename / title-by / schema change in the settings dialog: refresh names + the active view. */
	async function afterTypeSettingsChange() {
		types = await apiListMediaTypes().catch(() => types);
		if (activeTypeId && !isGlobals) {
			await loadSchema();
			await loadRecords();
			editorRefresh++;
		}
	}

	async function doDeleteType() {
		const id = deleteTargetId;
		if (!id) return;
		try {
			await apiDeleteMediaType(id);
			toast.success('Record type deleted');
			deleteOpen = false;
			settingsOpen = false;
			types = await apiListMediaTypes().catch(() => types);
			if (activeTypeId === id) {
				selectedRecordId = null;
				const next = types[0]?.id ?? null;
				activeTypeId = next;
				try {
					replaceState(next ? `/media?type=${encodeURIComponent(next)}` : '/media', {});
				} catch {
					/* router not ready */
				}
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete record type');
		}
	}

	async function afterBulk() {
		selectedIds.clear();
		await loadRecords();
	}

	// Initial load: settings (rail state), the type list, and the initial active type from ?type=.
	onMount(() => {
		settingsStore.fetchSettings();
		(async () => {
			try {
				types = await apiListMediaTypes();
			} catch (e) {
				console.error(e);
			}
			const wanted = $page.url.searchParams.get('type');
			activeTypeId = wanted && types.some((t) => t.id === wanted) ? wanted : (types[0]?.id ?? null);
			loadingTypes = false;
		})();
		return () => currentMediaTypeStore.set(null);
	});

	// Mirror the persisted rail-collapsed pref.
	$effect(() => {
		const unsub = settingsStore.subscribe((s) => {
			railCollapsed = s.railCollapsed;
		});
		return unsub;
	});

	// When the active type changes: set the shared store (for SchemaEditorButton) + load schema/records.
	$effect(() => {
		const id = activeTypeId;
		if (!id) return;
		const t = types.find((x) => x.id === id);
		currentMediaTypeStore.set({ typeId: id, kind: 'json', displayName: t?.displayName });
		if (id !== 'globals') {
			loadSchema();
			loadRecords();
		}
	});

	// Reload when filters / group-by / title-field / search change (search is server-side now).
	$effect(() => {
		filters;
		groupBy;
		titleField;
		subtitleField;
		query;
		searchField;
		if (activeTypeId && !isGlobals) loadRecords();
	});

	// Shared refresh triggers (fired by SchemaEditorButton / bulk actions).
	$effect(() => {
		let prev = 0;
		const unsub = refreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				if (activeTypeId && !isGlobals) loadRecords();
			}
		});
		return unsub;
	});
	$effect(() => {
		let prev = 0;
		const unsub = schemaRefreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				if (activeTypeId && !isGlobals) {
					loadSchema();
					loadRecords();
					editorRefresh++;
				}
			}
		});
		return unsub;
	});
</script>

<div class="flex h-screen w-full overflow-hidden">
	<RecordsRail
		{types}
		{activeTypeId}
		collapsed={railCollapsed}
		onSelect={selectType}
		onToggleCollapse={toggleRail}
		onNewType={() => (newTypeOpen = true)}
		onOpenSettings={openTypeSettings}
		onDeleteType={askDeleteType}
		bind:query
		bind:searchField
		{searchFields}
	/>

	{#if loadingTypes}
		<div class="flex flex-1 items-center justify-center p-8">
			<p class="text-muted-foreground">Loading…</p>
		</div>
	{:else if !activeTypeId}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<FolderOpen class="size-8 text-muted-foreground" />
			<p class="text-muted-foreground">No record types yet.</p>
			<Button onclick={() => (newTypeOpen = true)}>New record type</Button>
		</div>
	{:else if isGlobals}
		<div class="min-w-0 flex-1">
			<GlobalsEditorPane />
		</div>
	{:else}
		<RecordListColumn
			{typeName}
			typeId={activeTypeId}
			{schema}
			{records}
			{loading}
			bind:groupBy
			bind:filters
			{selectionMode}
			{selectedIds}
			{selectedRecordId}
			onOpen={(id) => (selectedRecordId = id)}
			onToggleSelect={toggleSelect}
			onNewRecord={createRecord}
			onToggleSelectionMode={toggleSelectionMode}
			onBulkChanged={afterBulk}
			onOpenSettings={() => activeTypeId && openTypeSettings(activeTypeId)}
			onDeleteType={() => activeTypeId && askDeleteType(activeTypeId)}
		/>

		{#if selectedRecordId}
			<RecordDetailPane
				typeId={activeTypeId}
				recordId={selectedRecordId}
				{titleField}
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
	{/if}
</div>

<Dialog.Root bind:open={newTypeOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Title>New record type</Dialog.Title>
		<Dialog.Description>A `json` record type — pure records, no file attachment.</Dialog.Description
		>
		<div class="flex flex-col gap-2 py-2">
			<Label for="new-type-name">Name</Label>
			<Input
				id="new-type-name"
				bind:value={newTypeName}
				placeholder="Record type name"
				onkeydown={(e) => e.key === 'Enter' && createRecordType()}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (newTypeOpen = false)}>Cancel</Button>
			<Button onclick={createRecordType} disabled={!newTypeName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if settingsTargetId}
	{#key settingsTargetId}
		<EntitySettingsDialog
			adapter={typeSettingsAdapter(settingsTargetId)}
			name={settingsTargetName}
			bind:open={settingsOpen}
			onchanged={afterTypeSettingsChange}
			ondeleted={async () => {
				const id = settingsTargetId;
				settingsOpen = false;
				types = await apiListMediaTypes().catch(() => types);
				if (activeTypeId === id) {
					selectedRecordId = null;
					activeTypeId = types[0]?.id ?? null;
				}
			}}
		/>
	{/key}
{/if}

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete record type</AlertDialog.Title>
		<AlertDialog.Description>
			Delete the record type “{deleteTargetName}” and all its records? This cannot be undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" onclick={doDeleteType}>Delete record type</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>
