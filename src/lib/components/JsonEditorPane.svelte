<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { toast } from 'svelte-sonner';
	import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import JsonRecordGrid from '$lib/components/JsonRecordGrid.svelte';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import {
		apiGetSchemaForType,
		apiGetRecordByIdForType,
		apiUpdatePropertiesByIdForType,
		apiDeleteRecordForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { settingsStore } from '$lib/stores/settings.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';

	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const selection = useSelection();

	let schema = $state<SchemaDefinition | null>(null);
	let record = $state<Record<string, unknown> | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let deleteOpen = $state(false);
	let formValues = $state<Record<string, unknown>>({});
	let lastSavedPatch = $state<Record<string, unknown>>({});
	/** Ordered editable keys (name first for JSON list/editor display). */
	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
		return keys.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
	}

	function initFormValues(s: SchemaDefinition, rec: Record<string, unknown> | null) {
		const next: Record<string, unknown> = {};
		for (const key of getOrderedEditableKeys(s)) {
			const def = s[key];
			const type = def?.type;
			let value: unknown =
				rec?.[key] ??
				def?.defaultValue ??
				(type === 'boolean'
					? false
					: type === 'number'
						? 0
						: type === 'dropdown'
							? (def as { multiselect?: boolean }).multiselect
								? []
								: (def?.options?.[0] ?? '')
							: type === 'list'
								? []
								: type === 'url'
									? { display_name: '', url: '' }
									: '');
			if (type === 'url') value = normalizeUrlValue(value);
			if (type === 'dropdown' && (def as { multiselect?: boolean }).multiselect) {
				value = Array.isArray(value)
					? value
					: typeof value === 'string' && value !== ''
						? [value]
						: [];
			}
			next[key] = type === 'number' ? String(value ?? '') : value;
		}
		formValues = next;
	}

	function buildPatch(): Record<string, unknown> {
		if (!schema) return {};
		const patch: Record<string, unknown> = {};
		for (const key of getOrderedEditableKeys(schema)) {
			const def = schema[key];
			const current = formValues[key];
			if (def?.type === 'number') {
				const n = Number(current);
				patch[key] = Number.isNaN(n) ? 0 : n;
			} else if (def?.type === 'url') {
				const urlVal =
					current != null && typeof current === 'object' && 'url' in (current as object)
						? (current as { display_name?: string; url?: string })
						: normalizeUrlValue(current);
				patch[key] = { display_name: urlVal.display_name ?? '', url: urlVal.url ?? '' };
			} else {
				patch[key] = current;
			}
		}
		return patch;
	}

	const isDirty = $derived(
		schema !== null &&
			record !== null &&
			JSON.stringify(buildPatch()) !== JSON.stringify(lastSavedPatch)
	);

	async function refresh() {
		if (!typeId || !selection.selectedImageId) {
			schema = null;
			record = null;
			return;
		}
		loading = true;
		try {
			const [s, r] = await Promise.all([
				apiGetSchemaForType(typeId),
				apiGetRecordByIdForType(typeId, selection.selectedImageId)
			]);
			schema = s;
			record = r as Record<string, unknown>;
			initFormValues(s, record);
			lastSavedPatch = buildPatch();
		} catch (e) {
			console.error(e);
			toast.error('Failed to load record');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const _id = selection.selectedImageId;
		const _t = typeId;
		if (typeId) refresh();
	});

	/**
	 * Register save-before-navigate: when user selects another record (sidebar or grid),
	 * save current edits first if autoSaveOnAdvance is on and form is dirty.
	 */
	$effect(() => {
		const unregister = selection.registerBeforeSelectAnother(async () => {
			if (!typeId) return;
			if (settingsStore.getCurrentSettings().autoSaveOnAdvance && isDirty) await save();
		});
		return () => unregister();
	});

	async function save() {
		if (!typeId || !selection.selectedImageId || !schema) return;
		saving = true;
		try {
			const updated = await apiUpdatePropertiesByIdForType(
				typeId,
				selection.selectedImageId,
				buildPatch()
			);
			record = updated as Record<string, unknown>;
			initFormValues(schema, record);
			lastSavedPatch = buildPatch();
			toast.success('Saved');
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to save');
		} finally {
			saving = false;
		}
	}

	async function deleteRecord() {
		if (!typeId || !selection.selectedImageId) return;
		try {
			await apiDeleteRecordForType(typeId, selection.selectedImageId);
			selection.selectImage(null);
			toast.success('Deleted');
			triggerImageListRefresh();
			deleteOpen = false;
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete');
		}
	}

	/**
	 * Navigate to previous/next record. If autoSaveOnAdvance is enabled and there are unsaved changes, saves first.
	 */
	async function navigate(direction: 'prev' | 'next') {
		if (typeId && isDirty && settingsStore.getCurrentSettings().autoSaveOnAdvance) {
			await save();
		}
		const ids = selection.visibleImageIds;
		const idx = ids.indexOf(selection.selectedImageId!);
		if (direction === 'prev' && idx > 0) selection.selectImage(ids[idx - 1]);
		if (direction === 'next' && idx >= 0 && idx < ids.length - 1)
			selection.selectImage(ids[idx + 1]);
	}
</script>

{#if selection.gridViewActive}
	<JsonRecordGrid />
{:else if !selection.selectedImageId}
	<div class="flex flex-col items-center justify-center h-full w-full p-8 gap-4">
		<p class="text-base text-muted-foreground text-center italic">
			Select a record from the sidebar or use New record in the sidebar.
		</p>
	</div>
{:else}
	<div class="flex flex-col h-dvh w-full">
		<div class="flex flex-wrap gap-2 p-3 border-b border-border shrink-0">
			<Button
				variant="secondary"
				size="icon"
				onclick={() => navigate('prev')}
				disabled={selection.visibleImageIds.indexOf(selection.selectedImageId) <= 0 || saving}
			>
				<ChevronLeft />
			</Button>
			<Button
				variant="secondary"
				size="icon"
				onclick={() => navigate('next')}
				disabled={saving ||
					selection.visibleImageIds.indexOf(selection.selectedImageId) === -1 ||
					selection.visibleImageIds.indexOf(selection.selectedImageId) >=
						selection.visibleImageIds.length - 1}
			>
				<ChevronRight />
			</Button>
			<Button variant="outline" onclick={save} disabled={saving || loading || !isDirty}>
				{saving ? 'Saving…' : 'Save'}
			</Button>
			<AlertDialog.Root bind:open={deleteOpen}>
				<AlertDialog.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="destructive" size="icon" aria-label="Delete">
							<Trash2 class="h-4 w-4" />
						</Button>
					{/snippet}
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Title>Delete record</AlertDialog.Title>
					<AlertDialog.Description
						>Remove this record? This cannot be undone.</AlertDialog.Description
					>
					<div class="flex justify-end gap-2 mt-4">
						<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
						<Button variant="destructive" type="button" onclick={deleteRecord}>Delete</Button>
					</div>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			{#if loading}
				<p class="italic">Loading…</p>
			{:else if schema}
				<Card.Root>
					<Card.Content class="pt-4">
						<div class="flex flex-col gap-4">
							{#each getOrderedEditableKeys(schema) as key (key)}
								{@const def = schema[key]}
								{@const rec = record as Record<string, unknown> | null}
								{@const mf = (rec?._missing_files ?? undefined) as
									| Record<string, string>
									| undefined}
								{@const isMissing =
									def?.type === 'file' && mf?.[key] !== undefined && formValues[key] === rec?.[key]}
								<div class="flex flex-col gap-2">
									<Label for={key}>{fieldLabel(key)}</Label>
									{#if def}
										<FieldInput
											{def}
											id={key}
											bind:value={formValues[key]}
											missing={isMissing}
											missingName={mf?.[key]}
											onEnterSave={save}
										/>
									{/if}
								</div>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</div>
{/if}
