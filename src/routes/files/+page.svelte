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
	import ClassSchemaDialog from '$lib/components/ClassSchemaDialog.svelte';
	import ClassSettingsDialog from '$lib/components/ClassSettingsDialog.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Home, MoreVertical, Plus, Upload, FileText } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { ClassSummary, FileItem } from '$lib/core/types.js';

	let files = $state<FileItem[]>([]);
	let classes = $state<ClassSummary[]>([]);
	let loading = $state(true);

	/** Catalog view (single class) config: ad-hoc group-by, grid size, and the class's schema keys. */
	let catalogSchemaKeys = $state<string[]>([]);
	let catalogGroupBy = $state('');
	let catalogSize = $state<'small' | 'medium' | 'large'>('medium');
	let catalogLoadedFor: string | null = null;
	/** Bumped to force the open editor panel to reload (e.g. after a class schema change). */
	let editorRefresh = $state(0);

	let query = $state('');
	const selectedClasses = new SvelteSet<string>();
	let unclassified = $state(false);
	let matchAll = $state(false);
	let classSearch = $state('');

	const selectedIds = new SvelteSet<string>();
	let editorFileId = $state<string | null>(null);
	let missing = $state<MissingFilesResponse>({ count: 0, files: [] });
	let showMissing = $state(false);

	let newClassName = $state('');
	let showNewClass = $state(false);
	let bulkClassId = $state('');
	let deleteFilesOpen = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Class management dialogs
	let schemaOpen = $state(false);
	let settingsOpen = $state(false);
	let manageClassId = $state('');
	let manageClassName = $state('');
	let deleteClassOpen = $state(false);
	let deleteClassId = $state('');
	let deleteClassName = $state('');

	const fileOptions = $derived(files.map((f) => ({ id: f.id, name: f.file_name })));
	const editorFile = $derived(files.find((f) => f.id === editorFileId) ?? null);
	const filteredClasses = $derived(
		classSearch
			? classes.filter((c) => c.displayName.toLowerCase().includes(classSearch.toLowerCase()))
			: classes
	);
	/** Single class selected (and not unclassified) ⇒ that class's catalog view. */
	const soloClass = $derived(
		!unclassified && selectedClasses.size === 1 ? [...selectedClasses][0] : null
	);
	const bulkLabel = $derived(
		classes.find((c) => c.id === bulkClassId)?.displayName ?? 'Add to class…'
	);

	/** Load a class's catalog config (group-by default, grid size, schema keys) for the catalog view. */
	async function loadCatalogConfig(classId: string) {
		try {
			const detail = await apiGetClass(classId);
			catalogSchemaKeys = Object.keys(detail.schema).sort((a, b) => a.localeCompare(b));
			catalogGroupBy = detail.config.gridGroupByField ?? '';
			catalogSize = detail.config.gridSize ?? 'medium';
		} catch {
			catalogSchemaKeys = [];
			catalogGroupBy = '';
			catalogSize = 'medium';
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
					query: query || undefined
				});
				files = data.files;
			} else {
				catalogLoadedFor = null;
				const data = await apiListFiles({
					query: query || undefined,
					classIds: unclassified ? [] : [...selectedClasses],
					matchAll,
					unclassified
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

	/** Files grouped by the catalog group-by value, or null when not grouping. */
	const groupedFiles = $derived.by(() => {
		if (!soloClass || !catalogGroupBy) return null;
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
	});

	/** Tile column min width (px) by grid size; the All Files view always uses medium. */
	const colMin = $derived(
		!soloClass ? 140 : catalogSize === 'small' ? 110 : catalogSize === 'large' ? 200 : 140
	);

	onMount(async () => {
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
		[...selectedClasses].join(',');
		unclassified;
		matchAll;
		loadFiles();
	});

	function toggleClassFilter(id: string) {
		if (selectedClasses.has(id)) selectedClasses.delete(id);
		else {
			selectedClasses.add(id);
			unclassified = false;
		}
	}

	function clearFilters() {
		selectedClasses.clear();
		unclassified = false;
		query = '';
	}

	function toggleSelect(id: string) {
		if (selectedIds.has(id)) selectedIds.delete(id);
		else selectedIds.add(id);
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

	function openSchema(c: ClassSummary) {
		manageClassId = c.id;
		manageClassName = c.displayName;
		schemaOpen = true;
	}

	function openSettings(c: ClassSummary) {
		manageClassId = c.id;
		manageClassName = c.displayName;
		settingsOpen = true;
	}

	function askDeleteClass(c: ClassSummary) {
		deleteClassId = c.id;
		deleteClassName = c.displayName;
		deleteClassOpen = true;
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

{#snippet tile(f: FileItem)}
	<Card.Root
		class="group relative cursor-pointer gap-0 overflow-hidden p-0 hover:ring-2 hover:ring-primary {editorFileId ===
		f.id
			? 'ring-2 ring-primary'
			: ''}"
		role="button"
		tabindex={0}
		onclick={() => (editorFileId = f.id)}
		onkeydown={(e) => e.key === 'Enter' && (editorFileId = f.id)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="absolute left-1 top-1 z-10 rounded bg-background/80 p-0.5"
			onclick={(e) => e.stopPropagation()}
		>
			<Checkbox checked={selectedIds.has(f.id)} onCheckedChange={() => toggleSelect(f.id)} />
		</div>
		<div class="flex aspect-square items-center justify-center bg-muted">
			{#if hasAllowedImageExtension(f.file_name)}
				<img
					src={apiBlobUrl(f.id)}
					alt={f.file_name}
					class="h-full w-full object-cover"
					loading="lazy"
				/>
			{:else}
				<FileText class="size-8 text-muted-foreground" />
			{/if}
		</div>
		<div class="p-1.5">
			<div class="truncate text-xs" title={f.file_name}>{f.file_name}</div>
			<div class="mt-0.5 flex flex-wrap gap-0.5">
				{#if f.classes.length === 0}
					<span class="text-[10px] text-muted-foreground">unclassified</span>
				{:else}
					{#each f.classes.slice(0, 3) as cid (cid)}
						<span class="rounded bg-secondary px-1 text-[10px] text-secondary-foreground"
							>{classes.find((c) => c.id === cid)?.displayName ?? cid}</span
						>
					{/each}
					{#if f.classes.length > 3}<span class="text-[10px] text-muted-foreground"
							>+{f.classes.length - 3}</span
						>{/if}
				{/if}
			</div>
		</div>
	</Card.Root>
{/snippet}

<Sidebar.Provider>
	<Sidebar.Root collapsible="none" class="h-screen border-r">
		<Sidebar.Header class="gap-2">
			<div class="flex items-center justify-between">
				<Button
					variant="ghost"
					size="sm"
					class="px-1 text-base font-semibold"
					onclick={clearFilters}
				>
					Files
				</Button>
				<Button variant="ghost" size="icon" title="Home" href="/">
					<Home class="size-4" />
				</Button>
			</div>
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
		</Sidebar.Header>

		<Sidebar.Content class="p-2">
			<Sidebar.Group>
				<div class="mb-1 flex items-center justify-between">
					<Sidebar.GroupLabel class="p-0">Classes</Sidebar.GroupLabel>
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
						<li class="flex items-center gap-2 rounded px-1 hover:bg-muted">
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
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="size-6"
											title="Manage class"
										>
											<MoreVertical class="size-4" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onSelect={() => openSchema(c)}>Edit schema</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => openSettings(c)}>Settings</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item class="text-destructive" onSelect={() => askDeleteClass(c)}>
										Delete class
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</li>
					{/each}
					{#if classes.length === 0}
						<li class="px-1 text-xs text-muted-foreground">No classes yet.</li>
					{/if}
				</ul>

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
			</Sidebar.Group>
		</Sidebar.Content>

		{#if showMissing && missing.count > 0}
			<Sidebar.Footer class="max-h-64 overflow-y-auto border-t text-xs">
				{#each missing.files as mf (mf.file_id)}
					<div class="mb-2">
						<div class="font-medium text-destructive">{mf.file_name || mf.file_id.slice(0, 8)}</div>
						<ul class="ml-2 list-disc">
							{#each mf.refs as r (r.context + r.label + r.field)}
								<li>{r.context} · {r.label}{r.field ? ` (${r.field})` : ''}</li>
							{/each}
						</ul>
					</div>
				{/each}
			</Sidebar.Footer>
		{/if}
	</Sidebar.Root>

	<!-- Main -->
	<main class="flex h-screen min-w-0 flex-1 flex-col">
		<header class="flex items-center gap-3 border-b p-3">
			<Input class="w-64" placeholder="Search filenames…" bind:value={query} />
			{#if selectedClasses.size > 1 && !unclassified}
				<Button variant="outline" size="sm" onclick={() => (matchAll = !matchAll)}>
					{matchAll ? 'all of' : 'any of'}
				</Button>
			{/if}
			<span class="text-sm text-muted-foreground"
				>{files.length} file{files.length === 1 ? '' : 's'}</span
			>
			{#if soloClass}
				<div class="flex items-center gap-1.5 text-sm">
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
					<span class="text-muted-foreground">Size</span>
					<Select.Root
						type="single"
						value={catalogSize}
						onValueChange={(v) => (catalogSize = v as typeof catalogSize)}
					>
						<Select.Trigger class="h-8 w-28">{catalogSize}</Select.Trigger>
						<Select.Content>
							<Select.Item value="small">small</Select.Item>
							<Select.Item value="medium">medium</Select.Item>
							<Select.Item value="large">large</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			<div class="flex-1"></div>
			<Button size="sm" onclick={() => fileInput?.click()}>
				<Upload class="size-4" /> Upload
			</Button>
			<input bind:this={fileInput} type="file" multiple class="hidden" onchange={onUpload} />
		</header>

		{#if selectedIds.size > 0}
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
				<Button size="sm" disabled={!bulkClassId} onclick={bulkAdd}>Add</Button>
				{#if soloClass}
					<Button variant="outline" size="sm" onclick={bulkRemove}>
						Remove from {classes.find((c) => c.id === soloClass)?.displayName}
					</Button>
				{/if}
				<Button variant="destructive" size="sm" onclick={() => (deleteFilesOpen = true)}>
					Delete from disk
				</Button>
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

		<div class="flex-1 overflow-y-auto p-4">
			{#if loading}
				<p class="text-muted-foreground">Loading…</p>
			{:else if files.length === 0}
				<p class="text-muted-foreground">No files.</p>
			{:else if groupedFiles}
				{#each groupedFiles as [groupKey, groupFiles] (groupKey)}
					<div class="mb-5">
						<h3 class="mb-2 text-sm font-semibold text-muted-foreground">
							{fieldLabel(catalogGroupBy)}: {groupKey}
							<span class="ml-1 font-normal">({groupFiles.length})</span>
						</h3>
						<div
							class="grid gap-3"
							style={`grid-template-columns: repeat(auto-fill, minmax(${colMin}px, 1fr))`}
						>
							{#each groupFiles as f (f.id)}
								{@render tile(f)}
							{/each}
						</div>
					</div>
				{/each}
			{:else}
				<div
					class="grid gap-3"
					style={`grid-template-columns: repeat(auto-fill, minmax(${colMin}px, 1fr))`}
				>
					{#each files as f (f.id)}
						{@render tile(f)}
					{/each}
				</div>
			{/if}
		</div>
	</main>

	{#if editorFile}
		<FileEditorPanel
			file={editorFile}
			{classes}
			{fileOptions}
			refresh={editorRefresh}
			onclose={() => (editorFileId = null)}
			onchanged={async () => {
				await loadMeta();
				await loadFiles();
			}}
		/>
	{/if}
</Sidebar.Provider>

<!-- Class management dialogs -->
{#if manageClassId}
	<ClassSchemaDialog
		classId={manageClassId}
		displayName={manageClassName}
		bind:open={schemaOpen}
		onchanged={afterClassChange}
	/>
	<ClassSettingsDialog
		classId={manageClassId}
		bind:open={settingsOpen}
		onchanged={afterClassChange}
	/>
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
