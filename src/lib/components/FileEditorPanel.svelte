<script lang="ts">
	import {
		apiBlobUrl,
		apiGetFileClasses,
		apiUpdateClassRecord,
		apiRenameFile,
		apiAddMembers,
		apiRemoveMembers,
		apiGetFileMetadata
	} from '$lib/api/files.js';
	import { hasAllowedImageExtension } from '$lib/core/images.js';
	import ClassFieldInput from './ClassFieldInput.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Info, X } from 'lucide-svelte';
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
		fileOptions = [],
		refresh = 0,
		onclose,
		onchanged
	}: {
		file: FileItem;
		classes: ClassSummary[];
		fileOptions?: { id: string; name: string }[];
		/** Bump from the parent to force a section reload (e.g. after a class schema change). */
		refresh?: number;
		onclose: () => void;
		onchanged: () => void;
	} = $props();

	let sections = $state<Section[]>([]);
	let loading = $state(true);
	let renaming = $state(file.file_name);
	let info = $state<Record<string, unknown> | null>(null);
	let showInfo = $state(false);
	let addClassId = $state('');

	const memberClassIds = $derived(new Set(sections.map((s) => s.id)));
	const addable = $derived(classes.filter((c) => !memberClassIds.has(c.id)));
	const isImage = $derived(hasAllowedImageExtension(file.file_name));
	const addLabel = $derived(
		addable.find((c) => c.id === addClassId)?.displayName ?? 'Add to class…'
	);

	async function load() {
		loading = true;
		try {
			const data = await apiGetFileClasses(file.id);
			sections = data.classes.map((c) => ({
				...c,
				record: (c.record ?? { id: file.id }) as Record<string, unknown>
			}));
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		// reload whenever the selected file changes
		file.id;
		renaming = file.file_name;
		info = null;
		showInfo = false;
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
		const patch: Record<string, unknown> = {};
		for (const key of Object.keys(section.schema)) {
			patch[key] = section.record[key] ?? null;
		}
		await apiUpdateClassRecord(section.id, file.id, patch);
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

	async function toggleInfo() {
		showInfo = !showInfo;
		if (showInfo && !info) {
			try {
				info = (await apiGetFileMetadata(file.id)) as Record<string, unknown>;
			} catch {
				info = { error: 'Could not read metadata' };
			}
		}
	}
</script>

<aside class="flex h-full w-[420px] shrink-0 flex-col border-l bg-card">
	<header class="flex items-center justify-between gap-2 border-b p-3">
		<Input
			class="min-w-0 flex-1 text-sm font-medium"
			bind:value={renaming}
			onblur={rename}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
		/>
		<Button variant="ghost" size="icon" title="Info" onclick={toggleInfo}>
			<Info class="size-4" />
		</Button>
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

		{#if showInfo}
			<pre class="mb-3 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(
					info,
					null,
					2
				)}</pre>
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
							<Label class="block">
								<span class="mb-0.5 block text-xs font-medium text-muted-foreground">{key}</span>
								<ClassFieldInput
									{def}
									bind:value={section.record[key]}
									{fileOptions}
									missing={isMissing(section, key)}
								/>
							</Label>
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
