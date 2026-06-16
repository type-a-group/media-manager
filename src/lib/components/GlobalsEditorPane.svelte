<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { Trash2, TriangleAlert } from 'lucide-svelte';
	import { apiGetGlobalsRecord, apiUpdateGlobalsRecord } from '$lib/api/client.js';
	import { autogrow, blurSaveOnEnter } from '$lib/actions/autogrow.js';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import { GLOBALS_FIELD_KINDS_KEY, GLOBALS_FIELD_META_KEY } from '$lib/core/fieldKeys.js';
	import FilePicker from './FilePicker.svelte';

	type ValueKind = 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' | 'file';
	type ItemType = 'string' | 'number' | 'url';
	type UrlValue = { display_name: string; url: string };
	/** Extra per-field metadata a schema would normally hold; persisted in `__field_meta`. */
	type FieldMeta = { options?: string[]; multiselect?: boolean; itemType?: ItemType };

	/**
	 * Globals has no schema, so per-field UI hints are stored alongside the data in reserved keys:
	 * `__field_kinds` (key → ValueKind) and `__field_meta` (key → FieldMeta). The server also annotates
	 * reads with `_missing_files` for broken `file` references. All three are hidden from the field list.
	 */
	const RESERVED = new Set([
		'id',
		'last_modified',
		'_missing_files',
		GLOBALS_FIELD_KINDS_KEY,
		GLOBALS_FIELD_META_KEY
	]);

	let loading = $state(true);
	let saving = $state(false);
	let baseValues = $state<Record<string, unknown>>({});
	let formValues = $state<Record<string, unknown>>({});
	let deletedKeys = $state<Set<string>>(new Set());
	let fieldKinds = $state<Record<string, ValueKind>>({});
	let fieldMeta = $state<Record<string, FieldMeta>>({});
	let missingFiles = $state<Record<string, string>>({});
	let pendingListItem = $state<Record<string, string>>({});
	let pendingListUrl = $state<Record<string, UrlValue>>({});

	// Add-field form
	let addKey = $state('');
	let addType = $state<ValueKind>('string');
	let addValue = $state('');
	let addOptions = $state(''); // comma-separated, for dropdown
	let addMultiselect = $state(false);
	let addItemType = $state<ItemType>('string');

	function editableFromRecord(rec: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rec)) {
			if (RESERVED.has(k)) continue;
			out[k] = v;
		}
		return out;
	}

	/** Parse persisted field-kind hints from the reserved key (tolerant of malformed input). */
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

	/** Parse persisted per-field metadata (options/multiselect/itemType) from the reserved key. */
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

	function inferKind(v: unknown): ValueKind {
		if (typeof v === 'number') return 'number';
		if (typeof v === 'boolean') return 'boolean';
		if (Array.isArray(v)) return 'list';
		if (v && typeof v === 'object' && 'url' in (v as object)) return 'url';
		return 'string';
	}

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
		// file stores a blob's manifest id (a string); keep an existing id, else reset to empty.
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
		// plain string
		return String(current ?? '');
	}

	function getMeta(key: string): FieldMeta {
		return fieldMeta[key] ?? {};
	}

	function setFieldKind(key: string, kind: ValueKind) {
		fieldKinds = { ...fieldKinds, [key]: kind };
		formValues = { ...formValues, [key]: coerceToKind(kind, formValues[key], getMeta(key)) };
	}

	function getFieldKind(key: string): ValueKind {
		return fieldKinds[key] ?? inferKind(formValues[key]);
	}

	function setFieldOptions(key: string, csv: string) {
		const options = csv
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		fieldMeta = { ...fieldMeta, [key]: { ...getMeta(key), options } };
	}

	function setFieldMultiselect(key: string, multi: boolean) {
		fieldMeta = { ...fieldMeta, [key]: { ...getMeta(key), multiselect: multi } };
		// Re-shape the current value to match (string <-> string[]).
		formValues = { ...formValues, [key]: coerceToKind('dropdown', formValues[key], getMeta(key)) };
	}

	function listItemDisplayText(item: unknown): string {
		if (item && typeof item === 'object' && 'url' in (item as object)) {
			const u = item as UrlValue;
			return (u.display_name ?? '').trim() || u.url || '';
		}
		return String(item);
	}

	async function load() {
		loading = true;
		try {
			const rec = (await apiGetGlobalsRecord()) as Record<string, unknown>;
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
			deletedKeys = new Set();
			pendingListItem = {};
			pendingListUrl = {};
		} catch (e) {
			console.error(e);
			toast.error('Failed to load globals');
		} finally {
			loading = false;
		}
	}

	function removeField(key: string) {
		const next = { ...formValues };
		delete next[key];
		formValues = next;
		const nextKinds = { ...fieldKinds };
		delete nextKinds[key];
		fieldKinds = nextKinds;
		const nextMeta = { ...fieldMeta };
		delete nextMeta[key];
		fieldMeta = nextMeta;
		if (key in baseValues) {
			const s = new Set(deletedKeys);
			s.add(key);
			deletedKeys = s;
		}
	}

	function addField() {
		const key = addKey.trim();
		if (!key) return;
		if (RESERVED.has(key)) {
			toast.error('This key is reserved');
			return;
		}
		if (key in formValues) {
			toast.error('Field already exists');
			return;
		}
		let val: unknown = '';
		let meta: FieldMeta = {};
		try {
			if (addType === 'number') val = Number(addValue || 0);
			else if (addType === 'boolean') val = addValue.trim().toLowerCase() === 'true';
			else if (addType === 'url') {
				val = normalizeUrlValue({ display_name: '', url: addValue.trim() });
			} else if (addType === 'list') {
				val = [];
				meta = { itemType: addItemType };
			} else if (addType === 'dropdown') {
				const options = addOptions
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				meta = { options, multiselect: addMultiselect };
				val = addMultiselect ? [] : (options[0] ?? '');
			} else if (addType === 'file') {
				val = '';
			} else val = addValue;
		} catch {
			/* fall through with default empty value */
		}
		formValues = { ...formValues, [key]: val };
		fieldKinds = { ...fieldKinds, [key]: addType };
		if (Object.keys(meta).length > 0) fieldMeta = { ...fieldMeta, [key]: meta };
		addKey = '';
		addType = 'string';
		addValue = '';
		addOptions = '';
		addMultiselect = false;
		addItemType = 'string';
	}

	function addListItem(key: string) {
		const itemType = getMeta(key).itemType ?? 'string';
		let item: unknown;
		if (itemType === 'url') {
			const u = pendingListUrl[key] ?? { display_name: '', url: '' };
			if (!u.url.trim()) return;
			item = { display_name: u.display_name.trim(), url: u.url.trim() };
			pendingListUrl = { ...pendingListUrl, [key]: { display_name: '', url: '' } };
		} else {
			const raw = (pendingListItem[key] ?? '').trim();
			if (!raw) return;
			item = itemType === 'number' ? Number(raw) : raw;
			pendingListItem = { ...pendingListItem, [key]: '' };
		}
		const arr = Array.isArray(formValues[key]) ? [...(formValues[key] as unknown[])] : [];
		arr.push(item);
		formValues = { ...formValues, [key]: arr };
	}

	function removeListItem(key: string, idx: number) {
		const arr = Array.isArray(formValues[key]) ? [...(formValues[key] as unknown[])] : [];
		arr.splice(idx, 1);
		formValues = { ...formValues, [key]: arr };
	}

	async function save() {
		saving = true;
		try {
			const patch: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(formValues)) patch[k] = v;
			for (const k of deletedKeys) patch[k] = null;
			// Persist per-field type + metadata hints so they survive reloads.
			const kindsToStore: Record<string, ValueKind> = {};
			const metaToStore: Record<string, FieldMeta> = {};
			for (const k of Object.keys(formValues)) {
				kindsToStore[k] = getFieldKind(k);
				const m = getMeta(k);
				if (m.options?.length || m.multiselect || m.itemType) metaToStore[k] = m;
			}
			patch[GLOBALS_FIELD_KINDS_KEY] = JSON.stringify(kindsToStore);
			patch[GLOBALS_FIELD_META_KEY] = JSON.stringify(metaToStore);
			await apiUpdateGlobalsRecord(patch);
			toast.success('Globals saved');
			triggerImageListRefresh();
			await load();
		} catch (e) {
			console.error(e);
			toast.error('Failed to save globals');
		} finally {
			saving = false;
		}
	}

	onMount(load);
</script>

<div class="flex h-dvh w-full flex-col gap-4 p-4 overflow-y-auto">
	<Card.Root>
		<Card.Header>
			<Card.Title>Globals</Card.Title>
			<Card.Description>
				Singleton app-wide record. Add/remove fields of any type; no schema.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if loading}
				<p class="text-muted-foreground">Loading…</p>
			{:else}
				<div class="flex flex-col gap-4">
					{#each Object.keys(formValues).sort() as key (key)}
						<div class="rounded border p-3 space-y-2">
							<div class="flex items-center justify-between gap-2">
								<div class="font-medium">{key}</div>
								<div class="flex items-center gap-2">
									<Select.Root
										type="single"
										value={getFieldKind(key)}
										onValueChange={(v) => v && setFieldKind(key, v as ValueKind)}
									>
										<Select.Trigger class="h-8 min-w-[8rem] text-xs">
											{getFieldKind(key)}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="string">string</Select.Item>
											<Select.Item value="number">number</Select.Item>
											<Select.Item value="boolean">boolean</Select.Item>
											<Select.Item value="dropdown">dropdown</Select.Item>
											<Select.Item value="list">list</Select.Item>
											<Select.Item value="url">url</Select.Item>
											<Select.Item value="file">file</Select.Item>
										</Select.Content>
									</Select.Root>
									<Button variant="ghost" size="icon" onclick={() => removeField(key)}>
										<Trash2 class="h-4 w-4" />
									</Button>
								</div>
							</div>
							{#if getFieldKind(key) === 'boolean'}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={formValues[key] === true}
										onCheckedChange={(checked) =>
											(formValues = { ...formValues, [key]: checked === true })}
									/>
									<Label>{formValues[key] === true ? 'True' : 'False'}</Label>
								</div>
							{:else if getFieldKind(key) === 'number'}
								<Input
									type="number"
									value={String(formValues[key] ?? 0)}
									oninput={(e) =>
										(formValues = {
											...formValues,
											[key]: Number((e.currentTarget as HTMLInputElement).value || 0)
										})}
								/>
							{:else if getFieldKind(key) === 'url'}
								{@const urlVal = normalizeUrlValue(formValues[key])}
								<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
									<Input
										type="text"
										placeholder="Display name"
										value={urlVal.display_name}
										oninput={(e) =>
											(formValues = {
												...formValues,
												[key]: {
													...(formValues[key] as UrlValue),
													display_name: (e.currentTarget as HTMLInputElement).value
												}
											})}
									/>
									<Input
										type="url"
										placeholder="https://..."
										value={urlVal.url}
										oninput={(e) =>
											(formValues = {
												...formValues,
												[key]: {
													...(formValues[key] as UrlValue),
													url: (e.currentTarget as HTMLInputElement).value
												}
											})}
									/>
								</div>
							{:else if getFieldKind(key) === 'dropdown'}
								{@const meta = getMeta(key)}
								{#if meta.multiselect}
									<Select.Root
										type="multiple"
										value={(formValues[key] ?? []) as string[]}
										onValueChange={(v) => (formValues = { ...formValues, [key]: v ?? [] })}
									>
										<Select.Trigger class="w-full">
											{((formValues[key] ?? []) as string[]).length === 0
												? '(none)'
												: ((formValues[key] ?? []) as string[]).join(', ')}
										</Select.Trigger>
										<Select.Content>
											{#each meta.options ?? [] as opt}
												<Select.Item value={opt}>{opt}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{:else}
									<Select.Root
										type="single"
										value={String(formValues[key] ?? '')}
										onValueChange={(v) => (formValues = { ...formValues, [key]: v ?? '' })}
									>
										<Select.Trigger class="w-full">
											{String(formValues[key] ?? '') || 'Select…'}
										</Select.Trigger>
										<Select.Content>
											{#each meta.options ?? [] as opt}
												<Select.Item value={opt}>{opt}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
								<div class="flex items-center gap-2">
									<Input
										class="text-xs"
										placeholder="Options (comma-separated)"
										value={(meta.options ?? []).join(', ')}
										oninput={(e) =>
											setFieldOptions(key, (e.currentTarget as HTMLInputElement).value)}
									/>
									<label class="flex items-center gap-1 text-xs whitespace-nowrap">
										<Checkbox
											checked={meta.multiselect === true}
											onCheckedChange={(c) => setFieldMultiselect(key, c === true)}
										/>
										Multiple
									</label>
								</div>
							{:else if getFieldKind(key) === 'list'}
								{@const itemType = getMeta(key).itemType ?? 'string'}
								<div class="space-y-2">
									<div class="flex flex-wrap gap-2">
										{#each Array.isArray(formValues[key]) ? formValues[key] : [] as item, idx (idx)}
											<span class="inline-flex items-center rounded border px-2 py-1 text-sm">
												{listItemDisplayText(item)}
												<button
													type="button"
													class="ml-2 text-muted-foreground hover:text-foreground"
													onclick={() => removeListItem(key, idx)}
												>
													x
												</button>
											</span>
										{/each}
									</div>
									<div class="flex gap-2 items-end flex-wrap">
										{#if itemType === 'url'}
											<Input
												type="text"
												placeholder="Display name"
												class="w-32"
												value={pendingListUrl[key]?.display_name ?? ''}
												oninput={(e) =>
													(pendingListUrl = {
														...pendingListUrl,
														[key]: {
															display_name: (e.currentTarget as HTMLInputElement).value,
															url: pendingListUrl[key]?.url ?? ''
														}
													})}
											/>
											<Input
												type="url"
												placeholder="https://..."
												class="flex-1 min-w-0"
												value={pendingListUrl[key]?.url ?? ''}
												oninput={(e) =>
													(pendingListUrl = {
														...pendingListUrl,
														[key]: {
															display_name: pendingListUrl[key]?.display_name ?? '',
															url: (e.currentTarget as HTMLInputElement).value
														}
													})}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														addListItem(key);
													}
												}}
											/>
										{:else}
											<Input
												type={itemType === 'number' ? 'number' : 'text'}
												placeholder="Add item"
												class="flex-1 min-w-0"
												value={pendingListItem[key] ?? ''}
												oninput={(e) =>
													(pendingListItem = {
														...pendingListItem,
														[key]: (e.currentTarget as HTMLInputElement).value
													})}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														addListItem(key);
													}
												}}
											/>
										{/if}
										<Button variant="outline" onclick={() => addListItem(key)}>Add</Button>
									</div>
								</div>
							{:else if getFieldKind(key) === 'file'}
								<div class="flex flex-col gap-1 w-full">
									<FilePicker
										value={formValues[key] as string}
										onSelect={(id) => (formValues = { ...formValues, [key]: id })}
									/>
									{#if missingFiles[key] !== undefined && formValues[key] === baseValues[key]}
										<div class="flex items-center justify-between gap-2 mt-1">
											<span class="text-xs text-destructive flex items-center gap-1">
												<TriangleAlert class="h-3 w-3 shrink-0" />
												{missingFiles[key]
													? `Missing file: ${missingFiles[key]}`
													: 'File not found on disk'}
											</span>
											<Button
												variant="ghost"
												size="sm"
												class="h-6 px-2 text-xs"
												onclick={() => (formValues = { ...formValues, [key]: '' })}
											>
												Clear
											</Button>
										</div>
									{/if}
								</div>
							{:else}
								<textarea
									rows="1"
									use:autogrow={formValues[key]}
									onkeydown={(e) => blurSaveOnEnter(e, save)}
									class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
									value={String(formValues[key] ?? '')}
									oninput={(e) =>
										(formValues = {
											...formValues,
											[key]: (e.currentTarget as HTMLTextAreaElement).value
										})}
								></textarea>
							{/if}
						</div>
					{/each}

					<div class="rounded border p-3 space-y-2">
						<div class="font-medium">Add field</div>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-2">
							<Input placeholder="field_key" bind:value={addKey} />
							<Select.Root
								type="single"
								value={addType}
								onValueChange={(v) => v && (addType = v as ValueKind)}
							>
								<Select.Trigger>{addType}</Select.Trigger>
								<Select.Content>
									<Select.Item value="string">string</Select.Item>
									<Select.Item value="number">number</Select.Item>
									<Select.Item value="boolean">boolean</Select.Item>
									<Select.Item value="dropdown">dropdown</Select.Item>
									<Select.Item value="list">list</Select.Item>
									<Select.Item value="url">url</Select.Item>
									<Select.Item value="file">file</Select.Item>
								</Select.Content>
							</Select.Root>
							{#if addType === 'dropdown'}
								<Input placeholder="Options (comma-separated)" bind:value={addOptions} />
							{:else if addType === 'list'}
								<Select.Root
									type="single"
									value={addItemType}
									onValueChange={(v) => v && (addItemType = v as ItemType)}
								>
									<Select.Trigger>{addItemType} items</Select.Trigger>
									<Select.Content>
										<Select.Item value="string">string</Select.Item>
										<Select.Item value="number">number</Select.Item>
										<Select.Item value="url">url</Select.Item>
									</Select.Content>
								</Select.Root>
							{:else if addType === 'boolean' || addType === 'file'}
								<div></div>
							{:else}
								<Input placeholder="initial value" bind:value={addValue} />
							{/if}
						</div>
						{#if addType === 'dropdown'}
							<label class="flex items-center gap-1 text-xs">
								<Checkbox
									checked={addMultiselect}
									onCheckedChange={(c) => (addMultiselect = c === true)}
								/>
								Allow multiple
							</label>
						{/if}
						<div class="flex justify-end">
							<Button variant="outline" onclick={addField}>Add field</Button>
						</div>
					</div>
				</div>
			{/if}
		</Card.Content>
		<Card.Footer class="justify-end">
			<Button onclick={save} disabled={saving || loading}
				>{saving ? 'Saving…' : 'Save globals'}</Button
			>
		</Card.Footer>
	</Card.Root>
</div>
