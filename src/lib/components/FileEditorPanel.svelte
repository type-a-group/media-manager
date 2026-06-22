<script lang="ts">
	import {
		apiBlobUrl,
		apiGetFileClasses,
		apiUpdateClassRecord,
		apiRenameFile,
		apiAddMembers,
		apiRemoveMembers
	} from '$lib/api/files.js';
	import { hasAllowedImageExtension, isPdfFilename } from '$lib/core/images.js';
	import FieldInput from './FieldInput.svelte';
	import MetadataButton from './MetadataButton.svelte';
	import EditorPanelShell from './EditorPanelShell.svelte';
	import { debouncedAutosave } from '$lib/actions/debouncedAutosave.svelte.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { FileText, Loader2, Check } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { ClassSummary, FileItem, SchemaDefinition, ClassConfig } from '$lib/core/types.js';

	/** One editable class section: schema/config plus the blob's (always-present) record. */
	type Section = {
		id: string;
		displayName: string;
		schema: SchemaDefinition;
		config: ClassConfig;
		record: Record<string, unknown>;
	};

	/**
	 * Per-file editor: one collapsible section per class the blob belongs to, each rendering that
	 * class's schema. Plus rename, intrinsic info, and add/remove-to-class. Edits **autosave** (debounced,
	 * mirroring the Records detail pane) — flushed on field blur/Enter, prev/next, file switch, close,
	 * and unload, with a "Saving…/Saved" status in the header. No explicit per-section Save button.
	 *
	 * Two distinct host callbacks keep autosave from flashing/clobbering the grid: `onSaved` (a field
	 * autosave — the grid tile is unaffected, so the host must NOT refetch the file list) vs
	 * `onStructureChanged` (rename / add / remove-to-class / metadata strip — the tile label, chips, or
	 * counts changed, so the host reloads). Refetching on every keystroke used to reassign the `file`
	 * prop and reload `sections` mid-typing, dropping characters.
	 */
	let {
		file,
		classes,
		refresh = 0,
		index = -1,
		total = 0,
		onPrev,
		onNext,
		onclose,
		onSaved,
		onStructureChanged
	}: {
		file: FileItem;
		classes: ClassSummary[];
		/** Bump from the parent to force a section reload (e.g. after a class schema change). */
		refresh?: number;
		/** Position of this file in the current filtered grid order (for prev/next). */
		index?: number;
		/** Total files in the current filtered grid order. */
		total?: number;
		onPrev?: () => void;
		onNext?: () => void;
		onclose: () => void;
		/** A field autosave settled — the grid tile is unchanged, so the host must NOT refetch. */
		onSaved?: () => void;
		/** Membership/name/metadata changed — the host should refresh the grid + class meta. */
		onStructureChanged: () => void;
	} = $props();

	let sections = $state<Section[]>([]);
	let loading = $state(true);
	let renaming = $state(file.file_name);
	let addClassId = $state('');
	/** When true, the image preview is shown full-screen over the whole app (click/Esc to close). */
	let lightboxOpen = $state(false);
	/** Per-section serialized snapshot at last save/load, to detect unsaved edits. */
	let savedSnapshots = $state<Record<string, string>>({});
	/** Debounced-autosave bookkeeping (mirrors the Records detail pane). */
	let saving = $state(false);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	const memberClassIds = $derived(new Set(sections.map((s) => s.id)));
	const addable = $derived(classes.filter((c) => !memberClassIds.has(c.id)));
	const isImage = $derived(hasAllowedImageExtension(file.file_name));
	const isPdfFile = $derived(isPdfFilename(file.file_name));
	const addLabel = $derived(
		addable.find((c) => c.id === addClassId)?.displayName ?? 'Add to class…'
	);

	/** The patch a section would save (its schema keys), used both for saving and dirty detection. */
	function patchFor(section: Section): Record<string, unknown> {
		const patch: Record<string, unknown> = {};
		for (const key of Object.keys(section.schema)) patch[key] = section.record[key] ?? null;
		return patch;
	}
	const snapshotOf = (section: Section) => JSON.stringify(patchFor(section));
	/** Any section with edits not yet persisted. */
	const dirty = $derived(sections.some((s) => snapshotOf(s) !== savedSnapshots[s.id]));

	// Shared debounced autosave: schedules `saveDirtySections` while dirty. `onSaved` (not a list
	// refetch) keeps the grid stable so typing never stutters.
	const autosave = debouncedAutosave({ isDirty: () => dirty, save: saveDirtySections });

	async function load() {
		loading = true;
		try {
			const data = await apiGetFileClasses(file.id);
			sections = data.classes.map((c) => ({
				...c,
				record: (c.record ?? { id: file.id }) as Record<string, unknown>
			}));
			savedSnapshots = Object.fromEntries(sections.map((s) => [s.id, snapshotOf(s)]));
		} finally {
			loading = false;
		}
	}

	/** Persist every section with unsaved edits, tracking a single save status for the panel header. */
	async function saveDirtySections() {
		if (saving || !dirty) return;
		saving = true;
		saveStatus = 'saving';
		try {
			for (const s of sections) {
				if (snapshotOf(s) !== savedSnapshots[s.id]) {
					await apiUpdateClassRecord(s.id, file.id, patchFor(s));
					savedSnapshots[s.id] = snapshotOf(s);
				}
			}
			saveStatus = 'saved';
			onSaved?.();
		} catch (e) {
			console.error(e);
			saveStatus = 'error';
			toast.error('Failed to save');
		} finally {
			saving = false;
		}
	}

	/** Cancel any pending debounce and persist immediately. */
	const flush = () => autosave.flush();

	/**
	 * Fire-and-forget flush for the file we're leaving (effect cleanup can't be async, and
	 * `beforeunload`). `fid` is captured so a mid-load file switch saves the OUTGOING blob's edits.
	 */
	function flushLeavingSync(fid: string) {
		autosave.cancel();
		if (saving || !dirty) return;
		for (const s of sections) {
			if (snapshotOf(s) !== savedSnapshots[s.id]) {
				const snap = snapshotOf(s);
				void apiUpdateClassRecord(s.id, fid, patchFor(s))
					.then(() => {
						savedSnapshots[s.id] = snap;
						onSaved?.();
					})
					.catch((e) => console.error('Autosave on leave failed', e));
			}
		}
	}

	/** Flush pending edits, then run a prev/next navigation. */
	async function advance(go: (() => void) | undefined) {
		if (!go) return;
		await flush();
		go();
	}

	async function handleClose() {
		await flush();
		onclose();
	}

	$effect(() => {
		// reload whenever the selected file changes; flush the outgoing blob's edits first
		const fid = file.id;
		renaming = file.file_name;
		lightboxOpen = false;
		load();
		return () => flushLeavingSync(fid);
	});

	// Best-effort flush if the tab is closed mid-edit.
	$effect(() => {
		const handler = () => flushLeavingSync(file.id);
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

	$effect(() => {
		// Close the full-screen preview on Escape.
		if (!lightboxOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') lightboxOpen = false;
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	$effect(() => {
		// reload sections on external request (e.g. a class schema changed while open)
		if (refresh) load();
	});

	/** Whether a `file`-field key is a broken reference on this section's record. */
	function isMissing(section: Section, key: string): boolean {
		const mf = section.record._missing_files as Record<string, string> | undefined;
		return !!mf && key in mf;
	}

	async function rename() {
		const next = renaming.trim();
		if (!next || next === file.file_name) return;
		await apiRenameFile(file.id, next);
		onStructureChanged();
	}

	async function addToClass() {
		if (!addClassId) return;
		await apiAddMembers(addClassId, [file.id]);
		addClassId = '';
		await load();
		onStructureChanged();
	}

	async function removeFromClass(classId: string) {
		await apiRemoveMembers(classId, [file.id]);
		await load();
		onStructureChanged();
	}
</script>

<EditorPanelShell
	{index}
	{total}
	onPrev={() => advance(onPrev)}
	onNext={() => advance(onNext)}
	onclose={handleClose}
>
	{#snippet titleArea()}
		<Input
			class="min-w-0 flex-1 text-sm font-medium"
			bind:value={renaming}
			onblur={rename}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
		/>
		<span class="shrink-0 text-xs text-muted-foreground">
			{#if saveStatus === 'saving'}
				<Loader2 class="inline size-3 animate-spin" /> Saving…
			{:else if saveStatus === 'saved' && !dirty}
				<Check class="inline size-3 text-green-600" /> Saved
			{:else if saveStatus === 'error'}
				<span class="text-destructive">Save failed</span>
			{/if}
		</span>
	{/snippet}
	{#snippet actions()}
		<MetadataButton id={file.id} filename={file.file_name} onchanged={onStructureChanged} />
	{/snippet}

	{#if isImage}
		<button
			type="button"
			class="mb-3 block w-full cursor-zoom-in rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			title="Click to preview full screen"
			onclick={() => (lightboxOpen = true)}
		>
			<img
				src={apiBlobUrl(file.id)}
				alt={file.file_name}
				class="max-h-48 w-full rounded object-contain"
			/>
		</button>
	{:else}
		<div
			class="mb-3 flex flex-col items-center justify-center gap-2 rounded border border-dashed py-8 text-muted-foreground"
		>
			<FileText class="h-10 w-10" />
			{#if isPdfFile}
				<a
					href={apiBlobUrl(file.id)}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-primary hover:underline"
				>
					Open PDF in new tab
				</a>
			{/if}
		</div>
	{/if}

	<div class="mb-3 flex items-center gap-2">
		<Select.Root type="single" value={addClassId} onValueChange={(v) => (addClassId = v)}>
			<Select.Trigger class="flex-1">{addLabel}</Select.Trigger>
			<Select.Content>
				{#each addable as c (c.id)}
					<Select.Item value={c.id}>{c.displayName}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<Button size="sm" disabled={!addClassId} onclick={addToClass}>Add</Button>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if sections.length === 0}
		<p class="text-sm text-muted-foreground">Not a member of any class yet. Add it to one above.</p>
	{:else}
		{#each sections as section (section.id)}
			<section class="mb-4 rounded border">
				<div class="flex items-center justify-between border-b bg-muted/50 px-2 py-1">
					<span class="text-sm font-semibold">{section.displayName}</span>
					<Button
						variant="link"
						size="sm"
						class="h-auto p-0 text-destructive"
						onclick={() => removeFromClass(section.id)}>remove</Button
					>
				</div>
				<div class="space-y-2 p-2">
					{#if Object.keys(section.schema).length === 0}
						<p class="text-xs text-muted-foreground">Pure tag (no fields).</p>
					{/if}
					{#each Object.entries(section.schema) as [key, def] (key)}
						<div class="space-y-0.5">
							<span class="mb-0.5 block text-xs font-medium text-muted-foreground">{key}</span>
							<FieldInput
								{def}
								bind:value={section.record[key]}
								missing={isMissing(section, key)}
								missingName={(
									section.record._missing_files as Record<string, string> | undefined
								)?.[key]}
								onEnterSave={flush}
							/>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</EditorPanelShell>

{#if lightboxOpen && isImage}
	<!-- Full-screen preview over the whole app; click anywhere (or Esc) to close. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
		role="button"
		tabindex="-1"
		onclick={() => (lightboxOpen = false)}
	>
		<img
			src={apiBlobUrl(file.id)}
			alt={file.file_name}
			class="max-h-full max-w-full object-contain"
		/>
	</div>
{/if}
