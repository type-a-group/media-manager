<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { Trash2 } from 'lucide-svelte';
	import { apiGetGlobalsRecord, apiUpdateGlobalsRecord } from '$lib/api/client.js';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { normalizeUrlValue } from '$lib/core/types.js';

	type ValueKind = 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' | 'file';
	type UrlValue = { display_name: string; url: string };

	let loading = $state(true);
	let saving = $state(false);
	let baseValues = $state<Record<string, unknown>>({});
	let formValues = $state<Record<string, unknown>>({});
	let deletedKeys = $state<Set<string>>(new Set());
	let fieldKinds = $state<Record<string, ValueKind>>({});
	let pendingListItem = $state<Record<string, string>>({});
	let addKey = $state('');
	let addType = $state<ValueKind>('string');
	let addValue = $state('');

	function editableFromRecord(rec: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rec)) {
			if (k === 'id' || k === 'last_modified') continue;
			out[k] = v;
		}
		return out;
	}

	function inferKind(v: unknown): ValueKind {
		if (typeof v === 'number') return 'number';
		if (typeof v === 'boolean') return 'boolean';
		if (Array.isArray(v)) return 'list';
		if (v && typeof v === 'object' && 'url' in (v as object)) return 'url';
		return 'string';
	}

	function coerceToKind(kind: ValueKind, current: unknown): unknown {
		if (kind === 'boolean') return current === true;
		if (kind === 'number') {
			const n = Number(current);
			return Number.isFinite(n) ? n : 0;
		}
		if (kind === 'url') {
			return normalizeUrlValue(current);
		}
		if (kind === 'list') {
			if (Array.isArray(current)) return current;
			if (typeof current === 'string' && current.trim().length > 0) return [current.trim()];
			return [];
		}
		// dropdown + string are both scalar string values in globals
		return String(current ?? '');
	}

	function setFieldKind(key: string, kind: ValueKind) {
		fieldKinds = { ...fieldKinds, [key]: kind };
		formValues = { ...formValues, [key]: coerceToKind(kind, formValues[key]) };
	}

	function getFieldKind(key: string): ValueKind {
		return fieldKinds[key] ?? inferKind(formValues[key]);
	}

	async function load() {
		loading = true;
		try {
			const rec = (await apiGetGlobalsRecord()) as Record<string, unknown>;
			const editable = editableFromRecord(rec);
			const nextKinds: Record<string, ValueKind> = {};
			for (const [k, v] of Object.entries(editable)) nextKinds[k] = inferKind(v);
			baseValues = editable;
			formValues = { ...editable };
			fieldKinds = nextKinds;
			deletedKeys = new Set();
			pendingListItem = {};
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
		if (key in baseValues) {
			const s = new Set(deletedKeys);
			s.add(key);
			deletedKeys = s;
		}
	}

	function addField() {
		const key = addKey.trim();
		if (!key) return;
		if (key === 'id' || key === 'last_modified') {
			toast.error('This key is reserved');
			return;
		}
		if (key in formValues) {
			toast.error('Field already exists');
			return;
		}
		let val: unknown = '';
		try {
			if (addType === 'number') val = Number(addValue || 0);
			else if (addType === 'boolean') val = addValue.trim().toLowerCase() === 'true';
			else if (addType === 'url') {
				val = normalizeUrlValue({ display_name: '', url: addValue.trim() });
			} else if (addType === 'list') {
				val = addValue.trim() ? [addValue.trim()] : [];
			} else if (addType === 'dropdown') {
				val = addValue;
			}
			else val = addValue;
		} catch {}
		formValues = { ...formValues, [key]: val };
		fieldKinds = { ...fieldKinds, [key]: addType };
		addKey = '';
		addType = 'string';
		addValue = '';
	}

	function addListItem(key: string) {
		const next = (pendingListItem[key] ?? '').trim();
		if (!next) return;
		const arr = Array.isArray(formValues[key]) ? [...(formValues[key] as unknown[])] : [];
		arr.push(next);
		formValues = { ...formValues, [key]: arr };
		pendingListItem = { ...pendingListItem, [key]: '' };
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
							{:else if getFieldKind(key) === 'list'}
								<div class="space-y-2">
									<div class="flex flex-wrap gap-2">
										{#each (Array.isArray(formValues[key]) ? formValues[key] : []) as item, idx (idx)}
											<span class="inline-flex items-center rounded border px-2 py-1 text-sm">
												{String(item)}
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
									<div class="flex gap-2">
										<Input
											type="text"
											placeholder="Add item"
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
										<Button variant="outline" onclick={() => addListItem(key)}>Add</Button>
									</div>
								</div>
							{:else}
								<Input
									type="text"
									value={String(formValues[key] ?? '')}
									oninput={(e) =>
										(formValues = {
											...formValues,
											[key]: (e.currentTarget as HTMLInputElement).value
										})}
								/>
							{/if}
						</div>
					{/each}

					<div class="rounded border p-3 space-y-2">
						<div class="font-medium">Add field</div>
						<div class="grid grid-cols-1 md:grid-cols-3 gap-2">
							<Input placeholder="field_key" bind:value={addKey} />
							<Select.Root type="single" value={addType} onValueChange={(v) => v && (addType = v as ValueKind)}>
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
							<Input placeholder="initial value" bind:value={addValue} />
						</div>
						<div class="flex justify-end">
							<Button variant="outline" onclick={addField}>Add field</Button>
						</div>
					</div>
				</div>
			{/if}
		</Card.Content>
		<Card.Footer class="justify-end">
			<Button onclick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save globals'}</Button>
		</Card.Footer>
	</Card.Root>
</div>
