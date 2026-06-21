<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		apiListFiles,
		apiListClassMembers,
		apiListClasses,
		apiCreateClass,
		apiAddMembers,
		apiRemoveMembers,
		apiDeleteFilesFromDisk,
		apiDeleteClass,
		apiUploadFile,
		apiBlobUrl,
		apiGetMissingFiles,
		apiGetClass,
		type MissingFilesResponse
	} from '$lib/api/files.js';
	import { fieldLabel } from '$lib/core/fieldKeys.js';
	import { hasAllowedImageExtension } from '$lib/core/images.js';
	import FileEditorPanel from '$lib/components/FileEditorPanel.svelte';
	import EntityRail from '$lib/components/rail/EntityRail.svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import SearchFieldSelect from '$lib/components/SearchFieldSelect.svelte';
	import EntityRowMenu from '$lib/components/entity-settings/EntityRowMenu.svelte';
	import EntitySettingsDialog from '$lib/components/entity-settings/EntitySettingsDialog.svelte';
	import { classSettingsAdapter } from '$lib/components/entity-settings/adapters.js';
	import DataGrid from '$lib/components/data-grid/DataGrid.svelte';
	import type { GridItem, GridConfig, GridCallbacks } from '$lib/components/data-grid/types.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { ListChecks, Plus, Upload, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { settingsStore } from '$lib/stores/settings.js';
	import type { ClassSummary, FileItem } from '$lib/core/types.js';

	let files = $state<FileItem[]>([]);
	let classes = $state<ClassSummary[]>([]);
	let loading = $state(true);

	/** Catalog view (single class) config: ad-hoc group-by and the class's schema keys. */
	let catalogSchemaKeys = $state<string[]>([]);
	let catalogGroupBy = $state('');
	let catalogLoadedFor: string | null = null;
	/**
	 * Grid size for every view here — a single global app setting (`media/settings.json`), shared
	 * with the catalog, multi-class, and `json` record grids. Synced from the store; changing it
	 * persists globally (see {@link setSize}).
	 */
	let gridSize = $state<'small' | 'medium' | 'large'>('medium');
	/** Group the All Files / "any of" views by each file's exact set of classes (flat by default). */
	let groupByClass = $state(false);
	/**
	 * Multi-class "all of" view: group by one class's field, encoded `classId::field` ('' = flat).
	 * Schema keys per selected class are loaded lazily into `crossSchemas` for the option list.
	 */
	let crossGroupBy = $state('');
	let crossSchemas = $state<Record<string, string[]>>({});
	/** Bumped to force the open editor panel to reload (e.g. after a class schema change). */
	let editorRefresh = $state(0);

	let query = $state('');
	/**
	 * Which field the search is scoped to. `''` = All fields (filename + fields) in a class context,
	 * or just Filename in the All-Files / "any of" view. In a single-class catalog it's a class field
	 * key; in the cross "all of" view it's the `classId::field` encoding (same as the group-by picker).
	 */
	let searchField = $state('');
	const selectedClasses = new SvelteSet<string>();
	let unclassified = $state(false);
	let matchAll = $state(false);
	let classSearch = $state('');

	const selectedIds = new SvelteSet<string>();
	/** Multiselect: off by default; toggled by the header button. Tiles only select while on. */
	let selectionMode = $state(false);
	let editorFileId = $state<string | null>(null);
	let missing = $state<MissingFilesResponse>({ count: 0, files: [] });
	let showMissing = $state(false);

	let newClassName = $state('');
	let showNewClass = $state(false);
	let bulkClassId = $state('');
	let deleteFilesOpen = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Unified class settings dialog (⋮ → Settings) + delete confirm.
	let settingsOpen = $state(false);
	let manageClassId = $state('');
	let manageClassName = $state('');
	let deleteClassOpen = $state(false);
	let deleteClassId = $state('');
	let deleteClassName = $state('');

	/** Rail collapse mirrors the shared global pref (same one the Records rail uses). */
	let railCollapsed = $state(false);

	const editorFile = $derived(files.find((f) => f.id === editorFileId) ?? null);
	const editorIndex = $derived(files.findIndex((f) => f.id === editorFileId));

	/** Open the neighbour file in the current filtered grid order. */
	function gotoFile(delta: number) {
		const next = files[editorIndex + delta];
		if (next) editorFileId = next.id;
	}
	const filteredClasses = $derived(
		classSearch
			? classes.filter((c) => c.displayName.toLowerCase().includes(classSearch.toLowerCase()))
			: classes
	);
	/** Single class selected (and not unclassified) ⇒ that class's catalog view. */
	const soloClass = $derived(
		!unclassified && selectedClasses.size === 1 ? [...selectedClasses][0] : null
	);
	/** Multiple classes intersected with "all of" ⇒ offer group-by-field across those classes. */
	const crossMode = $derived(matchAll && selectedClasses.size > 1 && !unclassified);
	/** Group-by options for {@link crossMode}: one `classId::field` entry per field, labelled `Class: field`. */
	const crossOptions = $derived.by(() => {
		if (!crossMode) return [] as { value: string; label: string }[];
		const opts: { value: string; label: string }[] = [];
		for (const cid of [...selectedClasses].sort((a, b) => a.localeCompare(b))) {
			const name = classLabel(cid);
			for (const k of crossSchemas[cid] ?? []) {
				opts.push({ value: `${cid}::${k}`, label: `${name}: ${fieldLabel(k)}` });
			}
		}
		return opts;
	});
	const crossGroupByLabel = $derived(
		crossGroupBy ? (crossOptions.find((o) => o.value === crossGroupBy)?.label ?? 'None') : 'None'
	);

	/**
	 * Fields offered by the rail's search-field picker — mirrors the group-by feature: a solo class's
	 * own fields, the `Class: field` set across an intersection, else none (filename only).
	 */
	const searchFields = $derived.by(() => {
		if (soloClass) return catalogSchemaKeys.map((k) => ({ key: k, label: fieldLabel(k) }));
		if (crossMode) return crossOptions.map((o) => ({ key: o.value, label: o.label }));
		return [] as { key: string; label: string }[];
	});
	/** The All-fields/Filename default label, and whether there's any field to narrow to. */
	const searchAllLabel = $derived(soloClass || crossMode ? 'All fields' : 'Filename');
	const searchFieldHasFields = $derived(soloClass != null || crossMode);

	// Drop a stale scoped field when the class context changes (e.g. solo → all files).
	$effect(() => {
		if (searchField && !searchFields.some((f) => f.key === searchField)) searchField = '';
	});
	const bulkLabel = $derived(
		classes.find((c) => c.id === bulkClassId)?.displayName ?? 'Add to class…'
	);

	/** Load a class's catalog config (group-by default, grid size, schema keys) for the catalog view. */
	async function loadCatalogConfig(classId: string) {
		try {
			const detail = await apiGetClass(classId);
			catalogSchemaKeys = Object.keys(detail.schema).sort((a, b) => a.localeCompare(b));
			catalogGroupBy = detail.config.gridGroupByField ?? '';
		} catch {
			catalogSchemaKeys = [];
			catalogGroupBy = '';
		}
	}

	async function loadFiles() {
		loading = true;
		try {
			if (soloClass) {
				if (catalogLoadedFor !== soloClass) {
					await loadCatalogConfig(soloClass);
					catalogLoadedFor = soloClass;
				}
				const data = await apiListClassMembers(soloClass, {
					groupBy: catalogGroupBy || undefined,
					query: query || undefined,
					searchField: searchField || undefined
				});
				files = data.files;
			} else {
				catalogLoadedFor = null;
				const [gc, gf] = crossMode && crossGroupBy ? crossGroupBy.split('::') : [];
				const data = await apiListFiles({
					query: query || undefined,
					classIds: unclassified ? [] : [...selectedClasses],
					matchAll,
					unclassified,
					groupByClass: gc,
					groupByField: gf,
					searchField: searchField || undefined
				});
				files = data.files;
			}
		} finally {
			loading = false;
		}
	}

	/** Re-run the catalog member query when the user picks a different group-by field. */
	async function changeCatalogGroupBy(field: string) {
		catalogGroupBy = field;
		await loadFiles();
	}

	/** Re-run the "all of" listing when the user picks a different cross-class group-by field. */
	async function changeCrossGroupBy(value: string) {
		crossGroupBy = value;
		await loadFiles();
	}

	async function loadMeta() {
		[classes, missing] = await Promise.all([
			apiListClasses(),
			apiGetMissingFiles().catch(() => ({ count: 0, files: [] }))
		]);
	}

	/** After a class schema/settings/delete change: refresh metadata, the grid, and the open panel. */
	async function afterClassChange() {
		catalogLoadedFor = null; // re-read group-by/size/schema for the catalog view
		await loadMeta();
		await loadFiles();
		editorRefresh++;
	}

	/** Resolve a class id to its display name (falls back to the raw id). */
	function classLabel(cid: string): string {
		return classes.find((c) => c.id === cid)?.displayName ?? cid;
	}

	/** Group files by their server-provided `group_by_value` (solo-class field or cross-class field). */
	function groupByFieldValue(): [string, FileItem[]][] {
		const groups: Record<string, FileItem[]> = {};
		for (const f of files) {
			const v = f.group_by_value;
			const key =
				v == null || v === ''
					? '—'
					: Array.isArray(v)
						? v.length
							? v.join(', ')
							: '—'
						: String(v);
			(groups[key] ??= []).push(f);
		}
		return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
	}

	/**
	 * Files grouped for the grid, or null when showing a flat list:
	 * - solo class + a chosen field → server-provided `group_by_value`;
	 * - multi-class "all of" + a chosen `Class: field` → likewise via `group_by_value`;
	 * - All Files / "any of" view + Group-by-class → each file's exact set of classes joined as one
	 *   combo group ("Images + Documents"), with member-less files under "Unclassified".
	 */
	const groupedFiles = $derived.by(() => {
		if (soloClass) {
			return catalogGroupBy ? groupByFieldValue() : null;
		}
		if (crossMode && crossGroupBy) {
			return groupByFieldValue();
		}
		if (groupByClass && !unclassified) {
			const groups: Record<string, FileItem[]> = {};
			for (const f of files) {
				const key =
					f.classes.length === 0
						? 'Unclassified'
						: f.classes
								.map(classLabel)
								.sort((a, b) => a.localeCompare(b))
								.join(' + ');
				(groups[key] ??= []).push(f);
			}
			return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
		}
		return null;
	});

	/** Map a blob row to a side-agnostic grid item (chips = class membership, capped at 3 + "+N"). */
	function toGridItem(f: FileItem): GridItem {
		const shown = f.classes.slice(0, 3);
		return {
			id: f.id,
			primaryLabel: f.file_name,
			thumbnailUrl: hasAllowedImageExtension(f.file_name) ? apiBlobUrl(f.id) : undefined,
			chips:
				f.classes.length === 0
					? [{ label: 'unclassified', tone: 'muted' }]
					: shown.map((cid) => ({ label: classLabel(cid) })),
			extraChips: f.classes.length > 3 ? f.classes.length - 3 : undefined,
			warning: f.missing_file_fields?.length
				? `Missing file reference: ${f.missing_file_fields.join(', ')}`
				: undefined
		};
	}

	const gridItems = $derived(files.map(toGridItem));
	const groupedGridItems = $derived<[string | null, GridItem[]][] | null>(
		groupedFiles
			? groupedFiles.map(([k, list]) => [k, list.map(toGridItem)] as [string | null, GridItem[]])
			: null
	);
	/** Persist a new grid size globally (every grid view subscribes to the settings store). */
	function setSize(v: 'small' | 'medium' | 'large') {
		gridSize = v;
		settingsStore.updateSetting('gridSize', v);
	}

	const gridConfig = $derived<GridConfig>({
		size: gridSize,
		selectable: selectionMode,
		activeId: editorFileId,
		// Solo/cross field groups prefix the (qualified) field name; class-combo keys are self-describing.
		groupLabel: (k) =>
			soloClass
				? `${fieldLabel(catalogGroupBy)}: ${k}`
				: crossMode && crossGroupBy
					? `${crossGroupByLabel}: ${k}`
					: k,
		emptyText: 'No files.'
	});
	const gridCallbacks: GridCallbacks = {
		onOpen: (id) => (editorFileId = id),
		onToggleSelect: (id) => toggleSelect(id),
		isSelected: (id) => selectedIds.has(id)
	};

	// Keep the toolbar size control in sync with the global settings store (so the Settings dialog
	// on this same page updates it live).
	$effect(() => {
		const unsubscribe = settingsStore.subscribe((s) => {
			gridSize = s.gridSize;
			railCollapsed = s.railCollapsed;
		});
		return () => unsubscribe();
	});

	function toggleRail() {
		railCollapsed = !railCollapsed;
		settingsStore.updateSetting('railCollapsed', railCollapsed);
	}

	onMount(async () => {
		await settingsStore.fetchSettings();
		await loadMeta();
		// ?class=<id> opens directly in that class's catalog view.
		const initialClass = $page.url.searchParams.get('class');
		if (initialClass && classes.some((c) => c.id === initialClass)) {
			selectedClasses.add(initialClass);
		}
		await loadFiles();
	});

	// Reload the grid when filters/search change.
	$effect(() => {
		query;
		searchField;
		[...selectedClasses].join(',');
		unclassified;
		matchAll;
		loadFiles();
	});

	// In "all of" mode, lazily load each selected class's schema keys for the group-by-field options.
	$effect(() => {
		if (!crossMode) return;
		for (const cid of [...selectedClasses]) {
			if (crossSchemas[cid]) continue;
			apiGetClass(cid)
				.then((d) => {
					crossSchemas = {
						...crossSchemas,
						[cid]: Object.keys(d.schema).sort((a, b) => a.localeCompare(b))
					};
				})
				.catch(() => {});
		}
	});

	function toggleClassFilter(id: string) {
		if (selectedClasses.has(id)) selectedClasses.delete(id);
		else {
			selectedClasses.add(id);
			unclassified = false;
		}
		crossGroupBy = ''; // a stale class::field would no longer match the selection
	}

	function clearFilters() {
		selectedClasses.clear();
		unclassified = false;
		query = '';
		crossGroupBy = '';
	}

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
	}

	/**
	 * Enter or leave multiselect. Entering closes the open editor and clears any prior selection so
	 * the selection ring can't be confused with the editor's active-tile ring; leaving clears too.
	 */
	function toggleSelectionMode() {
		selectedIds.clear();
		if (selectionMode) {
			selectionMode = false;
		} else {
			editorFileId = null;
			selectionMode = true;
		}
	}

	async function createClass() {
		const name = newClassName.trim();
		if (!name) return;
		const created = await apiCreateClass(name);
		newClassName = '';
		showNewClass = false;
		await loadMeta();
		selectedClasses.clear();
		selectedClasses.add(created.id);
	}

	async function bulkAdd() {
		if (!bulkClassId || selectedIds.size === 0) return;
		await apiAddMembers(bulkClassId, [...selectedIds]);
		bulkClassId = '';
		selectedIds.clear();
		await loadMeta();
		await loadFiles();
	}

	async function bulkRemove() {
		if (!soloClass || selectedIds.size === 0) return;
		await apiRemoveMembers(soloClass, [...selectedIds]);
		selectedIds.clear();
		await loadMeta();
		await loadFiles();
	}

	async function bulkDelete() {
		if (selectedIds.size === 0) return;
		await apiDeleteFilesFromDisk([...selectedIds]);
		selectedIds.clear();
		deleteFilesOpen = false;
		await loadMeta();
		await loadFiles();
	}

	async function onUpload(ev: Event) {
		const input = ev.currentTarget as HTMLInputElement;
		const list = input.files ? [...input.files] : [];
		for (const f of list) {
			try {
				await apiUploadFile(f, 'auto-rename');
			} catch (e) {
				console.error('upload failed', e);
			}
		}
		input.value = '';
		await loadMeta();
		await loadFiles();
	}

	function openSettings(c: ClassSummary) {
		manageClassId = c.id;
		manageClassName = c.displayName;
		settingsOpen = true;
	}

	/** Open settings for a class by id (used by the content-header ⋮ for the active solo class). */
	function openSettingsById(id: string) {
		const c = classes.find((x) => x.id === id);
		if (c) openSettings(c);
	}

	function askDeleteClass(c: ClassSummary) {
		deleteClassId = c.id;
		deleteClassName = c.displayName;
		deleteClassOpen = true;
	}

	/** Ask to delete a class by id (used by the content-header ⋮ for the active solo class). */
	function askDeleteClassById(id: string) {
		const c = classes.find((x) => x.id === id);
		if (c) askDeleteClass(c);
	}

	async function doDeleteClass() {
		try {
			await apiDeleteClass(deleteClassId);
			toast.success(`Deleted class “${deleteClassName}”`);
			selectedClasses.delete(deleteClassId);
			deleteClassOpen = false;
			await loadMeta();
			await loadFiles();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete class');
		}
	}
</script>

<div class="flex h-screen w-full overflow-hidden">
	<EntityRail title="Files" collapsed={railCollapsed} onToggleCollapse={toggleRail}>
		{#snippet belowHeader()}
			<div class="flex flex-col gap-2">
				<SearchBox bind:value={query} placeholder="Search files…" />
				<SearchFieldSelect
					fields={searchFields}
					bind:value={searchField}
					allLabel={searchAllLabel}
					disabled={!searchFieldHasFields}
				/>
				{#if missing.count > 0}
					<Button
						variant="ghost"
						size="sm"
						class="w-full justify-start bg-destructive/10 text-xs text-destructive hover:bg-destructive/20"
						onclick={() => (showMissing = !showMissing)}
					>
						⚠ {missing.count} file{missing.count === 1 ? '' : 's'} missing — review
					</Button>
				{/if}
			</div>
		{/snippet}

		{#snippet body()}
			<div class="mb-1 flex items-center justify-between">
				<span class="text-xs font-medium uppercase text-muted-foreground">Classes</span>
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-1 text-xs"
					onclick={() => (showNewClass = !showNewClass)}
				>
					<Plus class="size-3" /> New
				</Button>
			</div>
			{#if showNewClass}
				<div class="mb-2 flex gap-1">
					<Input
						class="h-8 text-sm"
						placeholder="Class name"
						bind:value={newClassName}
						onkeydown={(e) => e.key === 'Enter' && createClass()}
					/>
					<Button size="sm" class="h-8" onclick={createClass}>Add</Button>
				</div>
			{/if}
			{#if classes.length > 4}
				<Input class="mb-2 h-8 text-xs" placeholder="filter classes…" bind:value={classSearch} />
			{/if}
			<ul class="space-y-0.5">
				{#each filteredClasses as c (c.id)}
					<li class="group flex items-center gap-2 rounded px-1 hover:bg-muted">
						<Checkbox
							id={`cls-${c.id}`}
							checked={selectedClasses.has(c.id)}
							onCheckedChange={() => toggleClassFilter(c.id)}
						/>
						<Label
							for={`cls-${c.id}`}
							class="flex flex-1 cursor-pointer items-center gap-2 py-1 text-sm font-normal"
						>
							<span class="flex-1 truncate">{c.displayName}</span>
							<span class="text-xs text-muted-foreground">{c.count}</span>
						</Label>
						<span class="opacity-0 transition-opacity group-hover:opacity-100">
							<EntityRowMenu
								noun="class"
								onSettings={() => openSettings(c)}
								onDelete={() => askDeleteClass(c)}
							/>
						</span>
					</li>
				{/each}
				{#if classes.length === 0}
					<li class="px-1 text-xs text-muted-foreground">No classes yet.</li>
				{/if}
			</ul>

			{#if selectedClasses.size > 1 && !unclassified}
				<div class="mt-2 flex items-center gap-2">
					<span class="text-xs text-muted-foreground">Match</span>
					<Button
						variant="outline"
						size="sm"
						class="h-7"
						onclick={() => {
							matchAll = !matchAll;
							crossGroupBy = '';
						}}
					>
						{matchAll ? 'all of' : 'any of'}
					</Button>
				</div>
			{/if}

			<div class="mt-3 flex items-center gap-2 border-t pt-2">
				<Checkbox
					id="filter-unclassified"
					checked={unclassified}
					onCheckedChange={(v) => {
						unclassified = !!v;
						if (unclassified) selectedClasses.clear();
					}}
				/>
				<Label for="filter-unclassified" class="cursor-pointer text-sm font-normal">
					Unclassified
				</Label>
			</div>

			{#if showMissing && missing.count > 0}
				<div class="mt-3 max-h-64 overflow-y-auto border-t pt-2 text-xs">
					{#each missing.files as mf (mf.file_id)}
						<div class="mb-2">
							<div class="font-medium text-destructive">
								{mf.file_name || mf.file_id.slice(0, 8)}
							</div>
							<ul class="ml-2 list-disc">
								{#each mf.refs as r (r.context + r.label + r.field)}
									<li>{r.context} · {r.label}{r.field ? ` (${r.field})` : ''}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{/if}
		{/snippet}

		{#snippet collapsedBody()}
			<div class="flex flex-col items-center gap-0.5">
				{#each classes as c (c.id)}
					<Tooltip.Provider delayDuration={300}>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant={selectedClasses.has(c.id) ? 'secondary' : 'ghost'}
										size="icon"
										onclick={() => toggleClassFilter(c.id)}
									>
										<span class="text-xs font-semibold uppercase">{c.displayName.slice(0, 2)}</span>
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">{c.displayName} ({c.count})</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				{/each}
				<Tooltip.Provider delayDuration={300}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="mt-1"
									onclick={() => {
										toggleRail();
										showNewClass = true;
									}}
								>
									<Plus class="size-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">New class</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>
		{/snippet}
	</EntityRail>

	<!-- Main -->
	<main class="flex h-screen min-w-0 flex-1 flex-col">
		<header class="flex items-center gap-3 border-b p-3">
			<span class="text-sm text-muted-foreground"
				>{files.length} file{files.length === 1 ? '' : 's'}</span
			>
			<div class="flex items-center gap-1.5 text-sm">
				{#if soloClass}
					<span class="text-muted-foreground">Group by</span>
					<Select.Root type="single" value={catalogGroupBy} onValueChange={changeCatalogGroupBy}>
						<Select.Trigger class="h-8 w-36"
							>{catalogGroupBy ? fieldLabel(catalogGroupBy) : 'None'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							{#each catalogSchemaKeys as k (k)}
								<Select.Item value={k}>{fieldLabel(k)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{:else if crossMode}
					<span class="text-muted-foreground">Group by</span>
					<Select.Root type="single" value={crossGroupBy} onValueChange={changeCrossGroupBy}>
						<Select.Trigger class="h-8 w-48">{crossGroupByLabel}</Select.Trigger>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							{#each crossOptions as o (o.value)}
								<Select.Item value={o.value}>{o.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{:else if !unclassified}
					<span class="text-muted-foreground">Group by</span>
					<Select.Root
						type="single"
						value={groupByClass ? 'class' : ''}
						onValueChange={(v) => (groupByClass = v === 'class')}
					>
						<Select.Trigger class="h-8 w-36">{groupByClass ? 'Class' : 'None'}</Select.Trigger>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							<Select.Item value="class">Class</Select.Item>
						</Select.Content>
					</Select.Root>
				{/if}
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
			<Button
				variant={selectionMode ? 'secondary' : 'ghost'}
				size="sm"
				onclick={toggleSelectionMode}
				title={selectionMode ? 'Clear selection' : 'Select files'}
			>
				{#if selectionMode}
					<X class="size-4" /> Clear
				{:else}
					<ListChecks class="size-4" /> Select
				{/if}
			</Button>
			<Button size="sm" onclick={() => fileInput?.click()}>
				<Upload class="size-4" /> Upload
			</Button>
			<input bind:this={fileInput} type="file" multiple class="hidden" onchange={onUpload} />
			<!-- Content-header ⋮ for the active solo class — keeps its settings reachable when the rail is
			     collapsed (no single active entity in multi-select/All-Files mode, so it only shows here). -->
			{#if soloClass}
				<EntityRowMenu
					noun="class"
					title="Manage {classLabel(soloClass)}"
					triggerClass="size-8"
					onSettings={() => openSettingsById(soloClass)}
					onDelete={() => askDeleteClassById(soloClass)}
				/>
			{/if}
		</header>

		{#if selectionMode}
			<div class="flex flex-wrap items-center gap-2 border-b bg-muted/40 p-2 text-sm">
				<span>{selectedIds.size} selected</span>
				<Select.Root type="single" value={bulkClassId} onValueChange={(v) => (bulkClassId = v)}>
					<Select.Trigger class="h-8 w-44">{bulkLabel}</Select.Trigger>
					<Select.Content>
						{#each classes as c (c.id)}
							<Select.Item value={c.id}>{c.displayName}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button size="sm" disabled={!bulkClassId || selectedIds.size === 0} onclick={bulkAdd}>
					Add
				</Button>
				{#if soloClass}
					<Button
						variant="outline"
						size="sm"
						disabled={selectedIds.size === 0}
						onclick={bulkRemove}
					>
						Remove from {classes.find((c) => c.id === soloClass)?.displayName}
					</Button>
				{/if}
				<Button
					variant="destructive"
					size="sm"
					disabled={selectedIds.size === 0}
					onclick={() => (deleteFilesOpen = true)}
				>
					Delete from disk
				</Button>
				<Button variant="ghost" size="sm" class="ml-auto text-xs" onclick={toggleSelectionMode}>
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

	{#if editorFile}
		<FileEditorPanel
			file={editorFile}
			{classes}
			refresh={editorRefresh}
			index={editorIndex}
			total={files.length}
			onPrev={() => gotoFile(-1)}
			onNext={() => gotoFile(1)}
			onclose={() => (editorFileId = null)}
			onchanged={async () => {
				await loadMeta();
				await loadFiles();
			}}
		/>
	{/if}
</div>

<!-- Unified class settings dialog (rename + title-by + group-by + schema + delete) -->
{#if manageClassId}
	{#key manageClassId}
		<EntitySettingsDialog
			adapter={classSettingsAdapter(manageClassId)}
			name={manageClassName}
			bind:open={settingsOpen}
			onchanged={afterClassChange}
			ondeleted={async () => {
				selectedClasses.delete(manageClassId);
				settingsOpen = false;
				await loadMeta();
				await loadFiles();
			}}
		/>
	{/key}
{/if}

<AlertDialog.Root bind:open={deleteFilesOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete files from disk</AlertDialog.Title>
		<AlertDialog.Description>
			Permanently delete {selectedIds.size} file{selectedIds.size === 1 ? '' : 's'} from disk and remove
			them from every class. This cannot be undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" onclick={bulkDelete}>Delete</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteClassOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete class</AlertDialog.Title>
		<AlertDialog.Description>
			Delete the class “{deleteClassName}”? Its schema and per-file metadata are removed. The
			underlying files are not deleted. This cannot be undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" onclick={doDeleteClass}>Delete class</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>
