<script lang="ts">
	import {
		apiBlobUrl,
		apiGetFileClasses,
		apiUpdateClassRecord,
		apiRenameFile,
		apiAddMembers,
		apiRemoveMembers
	} from '$lib/api/files.js';
	import { hasAllowedImageExtension } from '$lib/core/images.js';
	import FieldInput from './FieldInput.svelte';
	import MetadataButton from './MetadataButton.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { X, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { settingsStore } from '$lib/stores/settings.js';
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
	 * class's schema. Plus rename, intrinsic info, and add/remove-to-class.
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
		onchanged
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
		onchanged: () => void;
	} = $props();

	let sections = $state<Section[]>([]);
	let loading = $state(true);
	let renaming = $state(file.file_name);
	let addClassId = $state('');
	/** Per-section serialized snapshot at last save/load, to detect unsaved edits before advancing. */
	let savedSnapshots: Record<string, string> = {};

	const memberClassIds = $derived(new Set(sections.map((s) => s.id)));
	const addable = $derived(classes.filter((c) => !memberClassIds.has(c.id)));
	const isImage = $derived(hasAllowedImageExtension(file.file_name));
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

	/** Save any sections with unsaved edits (used by autosave-on-advance). */
	async function saveDirtySections() {
		for (const s of sections) {
			if (snapshotOf(s) !== savedSnapshots[s.id]) await saveSection(s);
		}
	}

	/** Run a prev/next navigation, first autosaving dirty edits if the setting is enabled. */
	async function advance(go: (() => void) | undefined) {
		if (!go) return;
		if (settingsStore.getCurrentSettings().autoSaveOnAdvance) await saveDirtySections();
		go();
	}

	$effect(() => {
		// ←/→ walk the filtered grid order, unless focus is in a form control.
		function onKey(e: KeyboardEvent) {
			const el = document.activeElement as HTMLElement | null;
			if (
				el &&
				(el instanceof HTMLInputElement ||
					el instanceof HTMLTextAreaElement ||
					el instanceof HTMLSelectElement ||
					el.isContentEditable)
			)
				return;
			if (e.key === 'ArrowLeft' && index > 0) {
				e.preventDefault();
				advance(onPrev);
			} else if (e.key === 'ArrowRight' && index < total - 1) {
				e.preventDefault();
				advance(onNext);
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	$effect(() => {
		// reload whenever the selected file changes
		file.id;
		renaming = file.file_name;
		load();
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

	async function saveSection(section: Section) {
		await apiUpdateClassRecord(section.id, file.id, patchFor(section));
		savedSnapshots[section.id] = snapshotOf(section);
		onchanged();
	}

	async function rename() {
		const next = renaming.trim();
		if (!next || next === file.file_name) return;
		await apiRenameFile(file.id, next);
		onchanged();
	}

	async function addToClass() {
		if (!addClassId) return;
		await apiAddMembers(addClassId, [file.id]);
		addClassId = '';
		await load();
		onchanged();
	}

	async function removeFromClass(classId: string) {
		await apiRemoveMembers(classId, [file.id]);
		await load();
		onchanged();
	}
</script>

<aside class="flex h-full w-[420px] shrink-0 flex-col border-l bg-card">
	<header class="flex items-center gap-1 border-b p-3">
		<Button
			variant="outline"
			size="icon"
			title="Previous (←)"
			disabled={index <= 0}
			onclick={() => advance(onPrev)}
		>
			<ChevronLeft class="size-4" />
		</Button>
		<Button
			variant="outline"
			size="icon"
			title="Next (→)"
			disabled={index < 0 || index >= total - 1}
			onclick={() => advance(onNext)}
		>
			<ChevronRight class="size-4" />
		</Button>
		<Input
			class="min-w-0 flex-1 text-sm font-medium"
			bind:value={renaming}
			onblur={rename}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
		/>
		{#if isImage}
			<MetadataButton id={file.id} filename={file.file_name} {onchanged} />
		{/if}
		<Button variant="ghost" size="icon" title="Close" onclick={onclose}>
			<X class="size-4" />
		</Button>
	</header>

	<div class="flex-1 overflow-y-auto p-3">
		{#if isImage}
			<img
				src={apiBlobUrl(file.id)}
				alt={file.file_name}
				class="mb-3 max-h-48 w-full rounded object-contain"
			/>
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
			<p class="text-sm text-muted-foreground">
				Not a member of any class yet. Add it to one above.
			</p>
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
									onEnterSave={() => saveSection(section)}
								/>
							</div>
						{/each}
						<Button variant="secondary" size="sm" onclick={() => saveSection(section)}
							>Save {section.displayName}</Button
						>
					</div>
				</section>
			{/each}
		{/if}
	</div>
</aside>
