<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { Loader2, Check, Plus, Settings, FolderPlus, Search } from 'lucide-svelte';
	import { apiGetGlobalsRecord, apiUpdateGlobalsRecord } from '$lib/api/client.js';
	import { debouncedAutosave } from '$lib/actions/debouncedAutosave.svelte.js';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import { formatTimestamp } from '$lib/core/datetime.js';
	import {
		GLOBALS_FIELD_KINDS_KEY,
		GLOBALS_FIELD_META_KEY,
		GLOBALS_LAYOUT_KEY
	} from '$lib/core/fieldKeys.js';
	import {
		parseLayout,
		reconcileLayout,
		orderedFields,
		nextSectionId,
		type GlobalsLayout,
		type GlobalsFieldSort
	} from '$lib/core/globalsLayout.js';
	import GlobalsSection from './globals/GlobalsSection.svelte';
	import GlobalsFieldRow from './globals/GlobalsFieldRow.svelte';
	import FieldMenu from './globals/FieldMenu.svelte';
	import GlobalsSettingsDialog from './globals/GlobalsSettingsDialog.svelte';
	import type { FieldDefinition } from '$lib/core/types.js';

	type ValueKind = 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' | 'file';
	type ItemType = 'string' | 'number' | 'url';
	type FieldMeta = { options?: string[]; multiselect?: boolean; itemType?: ItemType };

	/**
	 * Globals editor — a sub-app-flavored **sectioned property table**. Fields are grouped into named
	 * collapsible sections (drag or `⋮ → Move`), each row is a clean `key → value` pair, and a field's
	 * structure (type, dropdown options / list item-type, rename, section, delete) lives in a per-field
	 * `⋮` {@link FieldMenu} popover. Globals still has no schema: per-field UI hints persist in the
	 * reserved record keys `__field_kinds` / `__field_meta`, and the sectioning persists in `__layout`
	 * (decoded/reconciled by `core/globalsLayout.ts`). All three are hidden from the field list.
	 *
	 * Save policy is identical to the records/files panels via {@link debouncedAutosave}: ~600ms debounce,
	 * Saving…/Saved status, no Save button, and — critically — it must NOT reload after save (that would
	 * reset `formValues` mid-edit). It advances the saved baseline in place instead.
	 */
	const RESERVED = new Set([
		'id',
		'last_modified',
		'_missing_files',
		GLOBALS_FIELD_KINDS_KEY,
		GLOBALS_FIELD_META_KEY,
		GLOBALS_LAYOUT_KEY
	]);

	let loading = $state(true);
	let saving = $state(false);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	/** Serialized editable state at last load/save — the baseline for the `dirty` autosave trigger. */
	let savedSnapshot = $state('');
	let baseValues = $state<Record<string, unknown>>({});
	let formValues = $state<Record<string, unknown>>({});
	/** Base keys the user removed (sent as `null` on save). SvelteSet ⇒ mutate in place, don't reassign. */
	const deletedKeys = new SvelteSet<string>();
	let fieldKinds = $state<Record<string, ValueKind>>({});
	let fieldMeta = $state<Record<string, FieldMeta>>({});
	let missingFiles = $state<Record<string, string>>({});
	let layout = $state<GlobalsLayout>({ sections: [], defaultSectionId: '', fieldSort: 'manual' });
	/** The record's `last_modified` (Item 9) — shown as a muted caption, mirroring the other editors. */
	let lastModified = $state<string | null>(null);

	let filterQuery = $state('');
	let settingsOpen = $state(false);

	// Section-delete confirm (only when the section still holds fields).
	let sectionPendingDelete = $state<string | null>(null);

	// --- drag & drop transient state ---
	let draggedFieldKey = $state<string | null>(null);
	let dragOverFieldKey = $state<string | null>(null);
	let draggedSectionId = $state<string | null>(null);

	const sectionOptions = $derived(layout.sections.map((s) => ({ id: s.id, name: s.name })));
	const fieldCount = $derived(Object.keys(formValues).length);

	// ---------------------------------------------------------------------------
	// kind / meta / value helpers (carried over from the previous editor)
	// ---------------------------------------------------------------------------
	function inferKind(v: unknown): ValueKind {
		if (typeof v === 'number') return 'number';
		if (typeof v === 'boolean') return 'boolean';
		if (Array.isArray(v)) return 'list';
		if (v && typeof v === 'object' && 'url' in (v as object)) return 'url';
		return 'string';
	}

	function getMeta(key: string): FieldMeta {
		return fieldMeta[key] ?? {};
	}

	function getFieldKind(key: string): ValueKind {
		return fieldKinds[key] ?? inferKind(formValues[key]);
	}

	/** Coerce a value into the shape a given kind expects (used on type/multiselect changes + add). */
	function coerceToKind(kind: ValueKind, current: unknown, meta: FieldMeta): unknown {
		if (kind === 'boolean') return current === true;
		if (kind === 'number') {
			const n = Number(current);
			return Number.isFinite(n) ? n : 0;
		}
		if (kind === 'url') return normalizeUrlValue(current);
		if (kind === 'list') {
			if (Array.isArray(current)) return current;
			if (typeof current === 'string' && current.trim().length > 0) return [current.trim()];
			return [];
		}
		if (kind === 'file') return typeof current === 'string' ? current : '';
		if (kind === 'dropdown') {
			if (meta.multiselect)
				return Array.isArray(current) ? current : current ? [String(current)] : [];
			return Array.isArray(current)
				? current[0] != null
					? String(current[0])
					: ''
				: String(current ?? '');
		}
		return String(current ?? '');
	}

	/** Build a schema-style FieldDefinition from a field's kind + stored meta, to drive FieldInput. */
	function syntheticDef(key: string): FieldDefinition {
		const meta = getMeta(key);
		return {
			type: getFieldKind(key),
			options: meta.options,
			multiselect: meta.multiselect,
			itemTypes: meta.itemType ? [meta.itemType] : undefined
		} as FieldDefinition;
	}

	function hasMeta(m: FieldMeta): boolean {
		return !!(m.options?.length || m.multiselect || m.itemType);
	}

	// ---------------------------------------------------------------------------
	// load / parse / reconcile
	// ---------------------------------------------------------------------------
	function editableFromRecord(rec: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rec)) {
			if (RESERVED.has(k)) continue;
			out[k] = v;
		}
		return out;
	}

	function parseStoredKinds(rec: Record<string, unknown>): Record<string, ValueKind> {
		const raw = rec[GLOBALS_FIELD_KINDS_KEY];
		if (typeof raw !== 'string') return {};
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const out: Record<string, ValueKind> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (
					v === 'string' ||
					v === 'number' ||
					v === 'boolean' ||
					v === 'dropdown' ||
					v === 'list' ||
					v === 'url' ||
					v === 'file'
				) {
					out[k] = v;
				}
			}
			return out;
		} catch {
			return {};
		}
	}

	function parseStoredMeta(rec: Record<string, unknown>): Record<string, FieldMeta> {
		const raw = rec[GLOBALS_FIELD_META_KEY];
		if (typeof raw !== 'string') return {};
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const out: Record<string, FieldMeta> = {};
			for (const [k, v] of Object.entries(parsed)) {
				if (!v || typeof v !== 'object') continue;
				const o = v as Record<string, unknown>;
				const m: FieldMeta = {};
				if (Array.isArray(o.options)) m.options = o.options.filter((x) => typeof x === 'string');
				if (typeof o.multiselect === 'boolean') m.multiselect = o.multiselect;
				if (o.itemType === 'string' || o.itemType === 'number' || o.itemType === 'url') {
					m.itemType = o.itemType;
				}
				out[k] = m;
			}
			return out;
		} catch {
			return {};
		}
	}

	/**
	 * Apply a fetched/imported record into editor state. Reconciles `__layout` against the actual keys
	 * (lazy-heal). `resetBaseline` settles the dirty baseline (normal load); pass `false` for import so
	 * the change is dirty and autosaves.
	 */
	function applyRecord(rec: Record<string, unknown>, resetBaseline = true) {
		if (typeof rec.last_modified === 'string') lastModified = rec.last_modified;
		const editable = editableFromRecord(rec);
		const storedKinds = parseStoredKinds(rec);
		const nextKinds: Record<string, ValueKind> = {};
		for (const [k, v] of Object.entries(editable)) nextKinds[k] = storedKinds[k] ?? inferKind(v);
		baseValues = editable;
		formValues = { ...editable };
		fieldKinds = nextKinds;
		fieldMeta = parseStoredMeta(rec);
		missingFiles =
			rec._missing_files && typeof rec._missing_files === 'object'
				? (rec._missing_files as Record<string, string>)
				: {};
		layout = reconcileLayout(parseLayout(rec[GLOBALS_LAYOUT_KEY]), Object.keys(editable));
		deletedKeys.clear();
		if (resetBaseline) {
			savedSnapshot = currentSnapshot();
			saveStatus = 'idle';
		}
	}

	async function load() {
		loading = true;
		try {
			const rec = (await apiGetGlobalsRecord()) as Record<string, unknown>;
			applyRecord(rec);
		} catch (e) {
			console.error(e);
			toast.error('Failed to load globals');
		} finally {
			loading = false;
		}
	}

	/** Serialize editable state (values + kinds/meta + layout + deletions) for dirty detection. */
	function currentSnapshot(): string {
		return JSON.stringify({
			values: formValues,
			kinds: fieldKinds,
			meta: fieldMeta,
			layout,
			deleted: [...deletedKeys].sort()
		});
	}

	const dirty = $derived(!loading && savedSnapshot !== '' && currentSnapshot() !== savedSnapshot);

	// ---------------------------------------------------------------------------
	// field operations
	// ---------------------------------------------------------------------------
	function sectionById(id: string) {
		return layout.sections.find((s) => s.id === id);
	}

	function addField(field: {
		key: string;
		kind: ValueKind;
		meta: FieldMeta;
		sectionId: string;
	}): boolean {
		const key = field.key.trim();
		if (!key) return false;
		if (RESERVED.has(key)) {
			toast.error('This key is reserved');
			return false;
		}
		if (key in formValues) {
			toast.error('Field already exists');
			return false;
		}
		formValues = { ...formValues, [key]: coerceToKind(field.kind, '', field.meta) };
		fieldKinds = { ...fieldKinds, [key]: field.kind };
		if (hasMeta(field.meta)) fieldMeta = { ...fieldMeta, [key]: field.meta };
		const target =
			sectionById(field.sectionId) ?? sectionById(layout.defaultSectionId) ?? layout.sections[0];
		if (target) {
			target.fields = [...target.fields, key];
			layout = { ...layout };
		}
		return true;
	}

	function removeField(key: string) {
		const next = { ...formValues };
		delete next[key];
		formValues = next;
		const nk = { ...fieldKinds };
		delete nk[key];
		fieldKinds = nk;
		const nm = { ...fieldMeta };
		delete nm[key];
		fieldMeta = nm;
		for (const s of layout.sections) s.fields = s.fields.filter((f) => f !== key);
		layout = { ...layout };
		if (key in baseValues) deletedKeys.add(key);
	}

	function renameField(oldKey: string, newKey: string): boolean {
		const next = newKey.trim();
		if (!next) return false;
		if (RESERVED.has(next)) {
			toast.error('This key is reserved');
			return false;
		}
		if (next === oldKey) return true;
		if (next in formValues) {
			toast.error('Field already exists');
			return false;
		}
		const nv = { ...formValues };
		nv[next] = nv[oldKey];
		delete nv[oldKey];
		formValues = nv;
		const nk = { ...fieldKinds };
		nk[next] = nk[oldKey];
		delete nk[oldKey];
		fieldKinds = nk;
		if (oldKey in fieldMeta) {
			const nm = { ...fieldMeta };
			nm[next] = nm[oldKey];
			delete nm[oldKey];
			fieldMeta = nm;
		}
		for (const s of layout.sections) {
			const i = s.fields.indexOf(oldKey);
			if (i >= 0) s.fields[i] = next;
		}
		layout = { ...layout };
		// A renamed persisted key must be dropped server-side; the new key persists via formValues.
		if (oldKey in baseValues) deletedKeys.add(oldKey);
		return true;
	}

	function setFieldKind(key: string, kind: ValueKind) {
		fieldKinds = { ...fieldKinds, [key]: kind };
		formValues = { ...formValues, [key]: coerceToKind(kind, formValues[key], getMeta(key)) };
	}

	function setFieldMeta(key: string, meta: FieldMeta) {
		fieldMeta = { ...fieldMeta, [key]: meta };
		if (getFieldKind(key) === 'dropdown') {
			formValues = { ...formValues, [key]: coerceToKind('dropdown', formValues[key], meta) };
		}
	}

	function moveFieldToSection(key: string, targetSectionId: string) {
		const target = sectionById(targetSectionId);
		if (!target || target.fields.includes(key)) return;
		for (const s of layout.sections) s.fields = s.fields.filter((f) => f !== key);
		target.fields = [...target.fields, key];
		layout = { ...layout };
	}

	// ---------------------------------------------------------------------------
	// section operations
	// ---------------------------------------------------------------------------
	function addSection() {
		const id = nextSectionId();
		const name = `Section ${layout.sections.length + 1}`;
		layout = {
			...layout,
			sections: [...layout.sections, { id, name, collapsed: false, fields: [] }]
		};
	}

	function renameSection(id: string, name: string) {
		layout = {
			...layout,
			sections: layout.sections.map((s) => (s.id === id ? { ...s, name } : s))
		};
	}

	function toggleCollapse(id: string, collapsed: boolean) {
		layout = {
			...layout,
			sections: layout.sections.map((s) => (s.id === id ? { ...s, collapsed } : s))
		};
	}

	function moveSection(id: string, dir: -1 | 1) {
		const idx = layout.sections.findIndex((s) => s.id === id);
		const to = idx + dir;
		if (idx < 0 || to < 0 || to >= layout.sections.length) return;
		const sections = [...layout.sections];
		[sections[idx], sections[to]] = [sections[to], sections[idx]];
		layout = { ...layout, sections };
	}

	/** Section `⋮ → Delete`: empty sections go immediately; non-empty ones ask first. */
	function requestDeleteSection(id: string) {
		if (layout.sections.length <= 1) {
			toast.error('Keep at least one section');
			return;
		}
		const s = sectionById(id);
		if (!s) return;
		if (s.fields.length === 0) {
			performDeleteSection(id, 'discard');
			return;
		}
		sectionPendingDelete = id;
	}

	/** `move` relocates the section's fields to the default section; `fields` deletes them too. */
	function performDeleteSection(id: string, mode: 'move' | 'fields' | 'discard') {
		const s = sectionById(id);
		if (!s) return;
		if (mode === 'fields') {
			for (const key of [...s.fields]) removeField(key);
		} else if (mode === 'move') {
			const fallback = layout.sections.find((x) => x.id !== id);
			const dest =
				layout.sections.find((x) => x.id === layout.defaultSectionId && x.id !== id) ?? fallback;
			if (dest) dest.fields = [...dest.fields, ...s.fields];
		}
		let sections = layout.sections.filter((x) => x.id !== id);
		const defaultSectionId =
			layout.defaultSectionId === id ? (sections[0]?.id ?? '') : layout.defaultSectionId;
		layout = { ...layout, sections, defaultSectionId };
		sectionPendingDelete = null;
	}

	// ---------------------------------------------------------------------------
	// drag & drop
	// ---------------------------------------------------------------------------
	function fieldDragStart(key: string) {
		draggedFieldKey = key;
		draggedSectionId = null;
	}
	function fieldDragOver(key: string) {
		if (draggedFieldKey) dragOverFieldKey = key;
	}
	function fieldDrop(targetKey: string) {
		const src = draggedFieldKey;
		if (!src || src === targetKey) return;
		const ts = layout.sections.find((s) => s.fields.includes(targetKey));
		if (!ts) return;
		for (const s of layout.sections) s.fields = s.fields.filter((f) => f !== src);
		const idx = ts.fields.indexOf(targetKey);
		ts.fields.splice(idx, 0, src);
		layout = { ...layout };
	}
	/** Drop a dragged field onto a section's body (e.g. an empty section) → append there. */
	function fieldDropInSection(sectionId: string) {
		const src = draggedFieldKey;
		if (!src) return;
		const target = sectionById(sectionId);
		if (!target || target.fields.includes(src)) return;
		for (const s of layout.sections) s.fields = s.fields.filter((f) => f !== src);
		target.fields = [...target.fields, src];
		layout = { ...layout };
	}
	function sectionDragStart(id: string) {
		draggedSectionId = id;
		draggedFieldKey = null;
	}
	function sectionDrop(targetId: string) {
		const src = draggedSectionId;
		if (!src || src === targetId) return;
		const from = layout.sections.findIndex((s) => s.id === src);
		const to = layout.sections.findIndex((s) => s.id === targetId);
		if (from < 0 || to < 0) return;
		const sections = [...layout.sections];
		const [moved] = sections.splice(from, 1);
		sections.splice(to, 0, moved);
		layout = { ...layout, sections };
	}
	function dragEnd() {
		draggedFieldKey = null;
		dragOverFieldKey = null;
		draggedSectionId = null;
	}

	// ---------------------------------------------------------------------------
	// filtering / export
	// ---------------------------------------------------------------------------
	function valueText(key: string): string {
		const v = formValues[key];
		if (v == null) return '';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	function visibleFields(fields: string[]): string[] {
		const ordered = orderedFields(fields, layout.fieldSort);
		const q = filterQuery.trim().toLowerCase();
		if (!q) return ordered;
		return ordered.filter(
			(k) => k.toLowerCase().includes(q) || valueText(k).toLowerCase().includes(q)
		);
	}

	/** A friendly, fully-decoded snapshot of the whole record for the settings export box. */
	const exportText = $derived(
		JSON.stringify(
			{
				...formValues,
				[GLOBALS_FIELD_KINDS_KEY]: Object.fromEntries(
					Object.keys(formValues).map((k) => [k, getFieldKind(k)])
				),
				[GLOBALS_FIELD_META_KEY]: Object.fromEntries(
					Object.keys(formValues)
						.filter((k) => hasMeta(getMeta(k)))
						.map((k) => [k, getMeta(k)])
				),
				[GLOBALS_LAYOUT_KEY]: layout
			},
			null,
			2
		)
	);

	/** Import a pasted record. Accepts meta keys as objects (friendly export) or strings (raw disk). */
	function importRecord(parsed: Record<string, unknown>) {
		const normalized: Record<string, unknown> = { ...parsed };
		for (const k of [GLOBALS_FIELD_KINDS_KEY, GLOBALS_FIELD_META_KEY, GLOBALS_LAYOUT_KEY]) {
			if (normalized[k] && typeof normalized[k] === 'object') {
				normalized[k] = JSON.stringify(normalized[k]);
			}
		}
		const prevKeys = Object.keys(baseValues);
		applyRecord(normalized, false); // keep dirty so autosave persists
		for (const k of prevKeys) if (!(k in formValues)) deletedKeys.add(k);
	}

	// ---------------------------------------------------------------------------
	// save (debounced autosave; never reloads)
	// ---------------------------------------------------------------------------
	async function save() {
		if (saving || !dirty) return;
		saving = true;
		saveStatus = 'saving';
		const persistedValues = { ...formValues };
		const baselineAfterSave = JSON.stringify({
			values: persistedValues,
			kinds: { ...fieldKinds },
			meta: JSON.parse(JSON.stringify(fieldMeta)),
			layout: JSON.parse(JSON.stringify(layout)),
			deleted: []
		});
		try {
			const patch: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(formValues)) patch[k] = v;
			for (const k of deletedKeys) patch[k] = null;
			const kindsToStore: Record<string, ValueKind> = {};
			const metaToStore: Record<string, FieldMeta> = {};
			for (const k of Object.keys(formValues)) {
				kindsToStore[k] = getFieldKind(k);
				const m = getMeta(k);
				if (hasMeta(m)) metaToStore[k] = m;
			}
			patch[GLOBALS_FIELD_KINDS_KEY] = JSON.stringify(kindsToStore);
			patch[GLOBALS_FIELD_META_KEY] = JSON.stringify(metaToStore);
			patch[GLOBALS_LAYOUT_KEY] = JSON.stringify(layout);
			const updated = (await apiUpdateGlobalsRecord(patch)) as Record<string, unknown>;
			if (typeof updated?.last_modified === 'string') lastModified = updated.last_modified;
			baseValues = persistedValues;
			deletedKeys.clear();
			savedSnapshot = baselineAfterSave;
			saveStatus = 'saved';
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			saveStatus = 'error';
			toast.error('Failed to save globals');
		} finally {
			saving = false;
		}
	}

	const autosave = debouncedAutosave({ isDirty: () => dirty, save });
	const flush = () => autosave.flush();

	$effect(() => {
		const handler = () => {
			if (dirty) void save();
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	});
	onDestroy(() => {
		autosave.cancel();
		if (dirty) void save();
	});

	onMount(load);

	const pendingSection = $derived(
		sectionPendingDelete ? sectionById(sectionPendingDelete) : undefined
	);
</script>

<div class="flex h-dvh w-full flex-col overflow-y-auto bg-muted/20">
	<!-- Toolbar -->
	<div class="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
		<div class="flex flex-wrap items-center gap-3 px-5 py-3">
			<div class="flex items-baseline gap-2">
				<h1 class="text-lg font-semibold">Globals</h1>
				<span class="text-sm text-muted-foreground">{fieldCount} fields</span>
			</div>

			<div class="relative ml-auto w-56">
				<Search
					class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input class="pl-8" placeholder="Filter fields…" bind:value={filterQuery} />
			</div>

			<FieldMenu
				mode="add"
				defaultSectionId={layout.defaultSectionId}
				sections={sectionOptions}
				onAdd={addField}
			>
				{#snippet trigger()}
					<Button size="sm">
						<Plus class="mr-1 size-4" /> Add field
					</Button>
				{/snippet}
			</FieldMenu>

			<Button
				variant="outline"
				size="icon"
				aria-label="Globals settings"
				onclick={() => (settingsOpen = true)}
			>
				<Settings class="size-4" />
			</Button>

			{#if lastModified}
				<span class="hidden text-xs text-muted-foreground sm:inline" title="Last modified">
					Modified {formatTimestamp(lastModified)}
				</span>
			{/if}

			<div class="w-20 text-right text-xs text-muted-foreground">
				{#if saveStatus === 'saving'}
					<Loader2 class="mr-1 inline size-3 animate-spin" /> Saving…
				{:else if saveStatus === 'saved' && !dirty}
					<Check class="mr-1 inline size-3 text-green-600" /> Saved
				{:else if saveStatus === 'error'}
					<span class="text-destructive">Failed</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Body -->
	<div class="mx-auto w-full max-w-3xl flex-1 space-y-1 px-5 py-4">
		{#if loading}
			<p class="text-muted-foreground">Loading…</p>
		{:else}
			{#each layout.sections as section, si (section.id)}
				<GlobalsSection
					{section}
					count={section.fields.length}
					isFirst={si === 0}
					isLast={si === layout.sections.length - 1}
					sections={sectionOptions}
					onToggleCollapse={(c) => toggleCollapse(section.id, c)}
					onRename={(name) => renameSection(section.id, name)}
					onMoveUp={() => moveSection(section.id, -1)}
					onMoveDown={() => moveSection(section.id, 1)}
					onDelete={() => requestDeleteSection(section.id)}
					onAddField={addField}
					onSectionDragStart={() => sectionDragStart(section.id)}
					onSectionDragOver={(e) => e.preventDefault()}
					onSectionDrop={() => sectionDrop(section.id)}
					onSectionDragEnd={dragEnd}
					onBodyDragOver={(e) => e.preventDefault()}
					onBodyDrop={() => fieldDropInSection(section.id)}
				>
					{#snippet body()}
						{#each visibleFields(section.fields) as key (key)}
							<GlobalsFieldRow
								fieldKey={key}
								def={syntheticDef(key)}
								bind:value={formValues[key]}
								kind={getFieldKind(key)}
								meta={getMeta(key)}
								sectionId={section.id}
								sections={sectionOptions}
								missing={missingFiles[key] !== undefined && formValues[key] === baseValues[key]}
								missingName={missingFiles[key]}
								onEnterSave={flush}
								onRename={renameField}
								onTypeChange={setFieldKind}
								onMetaChange={setFieldMeta}
								onMoveToSection={moveFieldToSection}
								onDelete={removeField}
								onDragStart={fieldDragStart}
								onDragOverRow={(k) => fieldDragOver(k)}
								onDropRow={fieldDrop}
								onDragEnd={dragEnd}
								dropIndicator={dragOverFieldKey === key &&
									draggedFieldKey !== null &&
									draggedFieldKey !== key}
							/>
						{/each}
						{#if filterQuery.trim() && visibleFields(section.fields).length === 0 && section.fields.length > 0}
							<p class="px-1 py-3 text-sm text-muted-foreground">No matching fields.</p>
						{/if}
					{/snippet}
				</GlobalsSection>
			{/each}

			<div class="pt-2">
				<Button variant="ghost" size="sm" class="text-muted-foreground" onclick={addSection}>
					<FolderPlus class="mr-1 size-4" /> New section
				</Button>
			</div>
		{/if}
	</div>
</div>

<GlobalsSettingsDialog
	bind:open={settingsOpen}
	fieldSort={layout.fieldSort}
	defaultSectionId={layout.defaultSectionId}
	sections={sectionOptions}
	{exportText}
	onFieldSortChange={(s: GlobalsFieldSort) => (layout = { ...layout, fieldSort: s })}
	onDefaultSectionChange={(id) => (layout = { ...layout, defaultSectionId: id })}
	onImport={importRecord}
/>

<!-- Confirm deleting a non-empty section. -->
<AlertDialog.Root
	open={sectionPendingDelete !== null}
	onOpenChange={(o) => {
		if (!o) sectionPendingDelete = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete “{pendingSection?.name}”?</AlertDialog.Title>
			<AlertDialog.Description>
				This section holds {pendingSection?.fields.length} field{(pendingSection?.fields.length ??
					0) === 1
					? ''
					: 's'}. Choose what happens to them.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer class="sm:justify-between">
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<div class="flex gap-2">
				<Button
					variant="outline"
					onclick={() => sectionPendingDelete && performDeleteSection(sectionPendingDelete, 'move')}
				>
					Keep fields
				</Button>
				<Button
					variant="destructive"
					onclick={() =>
						sectionPendingDelete && performDeleteSection(sectionPendingDelete, 'fields')}
				>
					Delete fields too
				</Button>
			</div>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
