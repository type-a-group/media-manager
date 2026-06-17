<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import EditorPanelShell from './EditorPanelShell.svelte';
	import FieldInput from './FieldInput.svelte';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import {
		apiGetSchemaForType,
		apiGetRecordByIdForType,
		apiUpdatePropertiesByIdForType,
		apiDeleteRecordForType
	} from '$lib/api/client.js';
	import { settingsStore } from '$lib/stores/settings.js';

	/**
	 * Per-record editor side panel for a `json` record type — the records-side counterpart to
	 * {@link FileEditorPanel}. Renders the type's schema as a stack of {@link FieldInput}s with Save and
	 * Delete, inside the shared {@link EditorPanelShell} (prev/next chevrons + ←/→ keys + close). The
	 * record grid stays mounted behind it.
	 *
	 * @param typeId - The `json` media type id.
	 * @param recordId - The record currently open (reloads when it changes).
	 * @param index - Position of this record in the current grid order (for prev/next).
	 * @param total - Total records in the current grid order.
	 * @param onPrev / onNext - Navigate the grid order (this panel autosaves first if enabled).
	 * @param onclose - Close the panel.
	 * @param onchanged - Called after a successful save so the host can refresh the grid.
	 * @param ondeleted - Called after a successful delete (host clears selection + refreshes).
	 * @param refresh - Bump from the host to force a reload (e.g. after a schema change).
	 */
	let {
		typeId,
		recordId,
		index = -1,
		total = 0,
		onPrev,
		onNext,
		onclose,
		onchanged,
		ondeleted,
		refresh = 0
	}: {
		typeId: string;
		recordId: string;
		index?: number;
		total?: number;
		onPrev?: () => void;
		onNext?: () => void;
		onclose: () => void;
		onchanged: () => void;
		ondeleted: () => void;
		refresh?: number;
	} = $props();

	let schema = $state<SchemaDefinition | null>(null);
	let record = $state<Record<string, unknown> | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let deleteOpen = $state(false);
	let formValues = $state<Record<string, unknown>>({});
	let lastSavedPatch = $state<Record<string, unknown>>({});

	/** Ordered editable keys (name first for display). */
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

	/** Display title for the header: the record's name field, falling back to a short id. */
	const title = $derived.by(() => {
		const n = (formValues.name ?? record?.name) as string | undefined;
		return n && String(n).trim() ? String(n) : recordId.slice(0, 8);
	});

	async function load() {
		loading = true;
		try {
			const [s, r] = await Promise.all([
				apiGetSchemaForType(typeId),
				apiGetRecordByIdForType(typeId, recordId)
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
		// Reload whenever the open record changes.
		recordId;
		typeId;
		load();
	});

	$effect(() => {
		// Reload on external request (e.g. a schema change while open).
		if (refresh) load();
	});

	async function save() {
		if (!schema) return;
		saving = true;
		try {
			const updated = await apiUpdatePropertiesByIdForType(typeId, recordId, buildPatch());
			record = updated as Record<string, unknown>;
			initFormValues(schema, record);
			lastSavedPatch = buildPatch();
			toast.success('Saved');
			onchanged();
		} catch (e) {
			console.error(e);
			toast.error('Failed to save');
		} finally {
			saving = false;
		}
	}

	async function deleteRecord() {
		try {
			await apiDeleteRecordForType(typeId, recordId);
			toast.success('Deleted');
			deleteOpen = false;
			ondeleted();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete');
		}
	}

	/** Run a prev/next navigation, first autosaving dirty edits if the setting is enabled. */
	async function advance(go: (() => void) | undefined) {
		if (!go) return;
		if (settingsStore.getCurrentSettings().autoSaveOnAdvance && isDirty) await save();
		go();
	}
</script>

<EditorPanelShell
	{index}
	{total}
	onPrev={() => advance(onPrev)}
	onNext={() => advance(onNext)}
	{onclose}
>
	{#snippet titleArea()}
		<span class="min-w-0 flex-1 truncate text-sm font-medium" {title}>{title}</span>
	{/snippet}
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={save} disabled={saving || loading || !isDirty}>
			{saving ? 'Saving…' : 'Save'}
		</Button>
		<AlertDialog.Root bind:open={deleteOpen}>
			<AlertDialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="destructive" size="icon" aria-label="Delete">
						<Trash2 class="size-4" />
					</Button>
				{/snippet}
			</AlertDialog.Trigger>
			<AlertDialog.Content>
				<AlertDialog.Title>Delete record</AlertDialog.Title>
				<AlertDialog.Description>Remove this record? This cannot be undone.</AlertDialog.Description
				>
				<div class="mt-4 flex justify-end gap-2">
					<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
					<Button variant="destructive" type="button" onclick={deleteRecord}>Delete</Button>
				</div>
			</AlertDialog.Content>
		</AlertDialog.Root>
	{/snippet}

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if schema}
		<Card.Root>
			<Card.Content class="pt-4">
				<div class="flex flex-col gap-4">
					{#each getOrderedEditableKeys(schema) as key (key)}
						{@const def = schema[key]}
						{@const rec = record as Record<string, unknown> | null}
						{@const mf = (rec?._missing_files ?? undefined) as Record<string, string> | undefined}
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
</EditorPanelShell>
