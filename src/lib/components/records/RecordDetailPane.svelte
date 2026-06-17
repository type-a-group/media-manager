<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Trash2, ChevronUp, ChevronDown, X, Check, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import { recordDetailTitle } from '$lib/core/recordDisplay.js';
	import {
		apiGetSchemaForType,
		apiGetRecordByIdForType,
		apiUpdatePropertiesByIdForType,
		apiDeleteRecordForType
	} from '$lib/api/client.js';

	/**
	 * The Records Explorer's right-hand detail pane: an inline, **autosaving** editor for a single
	 * record. It renders the type's schema as a stack of {@link FieldInput}s as a fixed column in the
	 * three-pane Explorer (not a floating aside) and drops the explicit Save button —
	 * edits are debounced and flushed on field blur, prev/next, record switch, close, and unload, with
	 * a "Saving…/Saved" status hint. Delete is kept (confirmed).
	 *
	 * @param typeId - The `json` media type id.
	 * @param recordId - The open record (reloads when it changes).
	 * @param titleField - The schema field currently used to title records (for the header).
	 * @param index / total - Position in the current list order (for prev/next + the counter).
	 * @param onPrev / onNext - Move along the list order (this pane flushes pending edits first).
	 * @param onclose - Clear the selection (shows the empty detail state).
	 * @param onchanged - Called after a successful save so the host can refresh the list.
	 * @param ondeleted - Called after a successful delete.
	 * @param refresh - Bump from the host to force a reload (e.g. after a schema change).
	 */
	let {
		typeId,
		recordId,
		titleField = '',
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
		titleField?: string;
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
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let deleteOpen = $state(false);
	let formValues = $state<Record<string, unknown>>({});
	let lastSavedPatch = $state<Record<string, unknown>>({});

	/** Identifies the record whose form is currently in `formValues` (for flush-on-leave). */
	let loaded = $state<{ typeId: string; recordId: string } | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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

	const title = $derived(recordDetailTitle(record, recordId, titleField));

	async function load() {
		loading = true;
		saveStatus = 'idle';
		try {
			const [s, r] = await Promise.all([
				apiGetSchemaForType(typeId),
				apiGetRecordByIdForType(typeId, recordId)
			]);
			schema = s;
			record = r as Record<string, unknown>;
			initFormValues(s, record);
			lastSavedPatch = buildPatch();
			loaded = { typeId, recordId };
		} catch (e) {
			console.error(e);
			toast.error('Failed to load record');
		} finally {
			loading = false;
		}
	}

	/** Persist the current edits if dirty. Returns when the write settles. */
	async function doSave() {
		if (!schema || saving) return;
		const patch = buildPatch();
		if (JSON.stringify(patch) === JSON.stringify(lastSavedPatch)) return;
		saving = true;
		saveStatus = 'saving';
		try {
			const updated = await apiUpdatePropertiesByIdForType(typeId, recordId, patch);
			record = updated as Record<string, unknown>;
			lastSavedPatch = patch;
			saveStatus = 'saved';
			onchanged();
		} catch (e) {
			console.error(e);
			saveStatus = 'error';
			toast.error('Failed to save');
		} finally {
			saving = false;
		}
	}

	/** Cancel any pending debounce and persist immediately. */
	async function flush() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		await doSave();
	}

	/**
	 * Fire-and-forget flush for the record we're leaving — used in the load effect's cleanup (which
	 * can't be async) and on `beforeunload`. Reads the still-current form state for the outgoing
	 * record before `load()` overwrites it.
	 */
	function flushLeavingSync() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (!loaded || !schema || saving) return;
		const patch = buildPatch();
		if (JSON.stringify(patch) === JSON.stringify(lastSavedPatch)) return;
		void apiUpdatePropertiesByIdForType(loaded.typeId, loaded.recordId, patch)
			.then(() => onchanged())
			.catch((e) => console.error('Autosave on leave failed', e));
	}

	// Debounced autosave: whenever the form drifts from the last saved patch, schedule a write.
	$effect(() => {
		const patch = buildPatch();
		const dirty =
			schema !== null &&
			record !== null &&
			JSON.stringify(patch) !== JSON.stringify(lastSavedPatch);
		if (!dirty) return;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void doSave();
		}, 600);
		return () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
		};
	});

	// Reload whenever the open record changes; flush the outgoing record's edits first.
	$effect(() => {
		recordId;
		typeId;
		load();
		return () => flushLeavingSync();
	});

	// Reload on external request (e.g. a schema change while open).
	$effect(() => {
		if (refresh) load();
	});

	// Best-effort flush if the tab is closed mid-edit.
	$effect(() => {
		const handler = () => flushLeavingSync();
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});

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

	async function deleteRecord() {
		try {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			await apiDeleteRecordForType(typeId, recordId);
			toast.success('Deleted');
			deleteOpen = false;
			ondeleted();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete');
		}
	}
</script>

<aside class="flex h-screen w-[440px] shrink-0 flex-col border-l bg-background">
	<header class="flex items-center gap-1.5 border-b p-3">
		<div class="flex shrink-0 items-center">
			<Button
				variant="ghost"
				size="icon"
				disabled={index <= 0}
				onclick={() => advance(onPrev)}
				title="Previous (saves first)"
			>
				<ChevronUp class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				disabled={index < 0 || index >= total - 1}
				onclick={() => advance(onNext)}
				title="Next (saves first)"
			>
				<ChevronDown class="size-4" />
			</Button>
		</div>
		<span class="min-w-0 flex-1 truncate text-sm font-medium" {title}>{title}</span>
		<span class="shrink-0 text-xs text-muted-foreground">
			{#if saveStatus === 'saving'}
				<Loader2 class="inline size-3 animate-spin" /> Saving…
			{:else if saveStatus === 'saved' && !isDirty}
				<Check class="inline size-3 text-green-600" /> Saved
			{:else if saveStatus === 'error'}
				<span class="text-destructive">Save failed</span>
			{/if}
		</span>
		<AlertDialog.Root bind:open={deleteOpen}>
			<AlertDialog.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon" aria-label="Delete">
						<Trash2 class="size-4 text-destructive" />
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
		<Button variant="ghost" size="icon" aria-label="Close" onclick={handleClose}>
			<X class="size-4" />
		</Button>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto p-3">
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
										onEnterSave={flush}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</aside>
