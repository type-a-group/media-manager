<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { CheckSquare, Square, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import type { ImageListItem } from '$lib/core/types.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import {
		apiGetSchemaForType,
		apiUpdatePropertiesByIdForType,
		apiDeleteRecordForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';

	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const selection = useSelection();

	let deleteConfirmOpen = $state(false);
	let setFieldDialogOpen = $state(false);
	let setFieldSchema = $state<SchemaDefinition | null>(null);
	let setFieldKey = $state('');
	let setFieldValue = $state<string | number | boolean | string[] | { display_name: string; url: string }>('');
	let gridSchemaFields = $state<string[]>([]);
	let groupByValue = $state('');

	$effect(() => {
		const next = groupByValue ? groupByValue : null;
		if (selection.gridGroupByField !== next) selection.setGridGroupByField(next);
	});
	$effect(() => {
		const fromSelection = selection.gridGroupByField ?? '';
		if (groupByValue !== fromSelection) groupByValue = fromSelection;
	});

	let gridSizeOption = $state<'small' | 'medium' | 'large'>('medium');
	$effect(() => {
		if (gridSizeOption !== selection.gridSize) gridSizeOption = selection.gridSize;
	});

	const gridMinPx = $derived(
		selection.gridSize === 'small' ? 80 : selection.gridSize === 'large' ? 180 : 120
	);

	$effect(() => {
		if (typeId) {
			apiGetSchemaForType(typeId).then((s) => {
				gridSchemaFields = getOrderedEditableKeys(s);
			}).catch(() => {});
		}
	});

	/**
	 * Ordered editable keys from schema (name first for JSON list/grid display).
	 */
	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
		return keys.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
	}

	function getDisplayName(item: ImageListItem & { name?: string; group_by_value?: string | number | boolean | string[] | null }): string {
		const n = (item as { name?: string }).name?.trim();
		if (n && n.length > 0) return n;
		if (item.group_by_value != null && item.group_by_value !== '') return String(item.group_by_value);
		return (item.id as string).slice(0, 8);
	}

	async function openSetFieldDialog() {
		if (!typeId) return;
		try {
			const s = await apiGetSchemaForType(typeId);
			setFieldSchema = s;
			const keys = getOrderedEditableKeys(s);
			setFieldKey = keys[0] ?? '';
			const def = s[setFieldKey];
			setFieldValue =
				def?.type === 'boolean'
					? false
					: def?.type === 'number'
						? 0
						: def?.type === 'list'
							? []
							: '';
			setFieldDialogOpen = true;
		} catch (e) {
			console.error(e);
			toast.error('Failed to load schema');
		}
	}

	function getCoercedValue(): string | number | boolean | string[] | { display_name: string; url: string } | null {
		if (!setFieldSchema || !setFieldKey) return null;
		const def = setFieldSchema[setFieldKey];
		const type = def?.type ?? 'string';
		const raw = setFieldValue;
		if (type === 'number') {
			const n = typeof raw === 'number' ? raw : Number(raw);
			return Number.isFinite(n) ? n : null;
		}
		if (type === 'boolean') return Boolean(raw);
		if (type === 'dropdown' && (def as { multiselect?: boolean }).multiselect) {
			return Array.isArray(raw) ? (raw as string[]) : [];
		}
		if (type === 'list') return Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
		if (type === 'url') {
			if (raw != null && typeof raw === 'object' && 'url' in raw) return raw as { display_name: string; url: string };
			return { display_name: '', url: typeof raw === 'string' ? raw : '' };
		}
		return raw === null || raw === undefined ? '' : String(raw);
	}

	async function handleSetFieldSubmit() {
		const ids = [...selection.multiselectedIds];
		if (ids.length === 0 || !setFieldKey) return;
		const value = getCoercedValue();
		if (value === null && setFieldSchema?.[setFieldKey]?.type !== 'number') return;
		try {
			for (const id of ids) {
				await apiUpdatePropertiesByIdForType(typeId!, id, { [setFieldKey]: value });
			}
			toast.success(`Updated ${ids.length} record${ids.length === 1 ? '' : 's'}`);
			setFieldDialogOpen = false;
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to update records');
		}
	}

	$effect(() => {
		if (!setFieldDialogOpen || !setFieldSchema) return;
		const key = setFieldKey;
		if (!key) return;
		const def = setFieldSchema[key];
		setFieldValue =
			def?.type === 'boolean'
				? false
				: def?.type === 'number'
					? 0
					: def?.type === 'list'
						? ''
						: def?.type === 'dropdown' && (def as { multiselect?: boolean }).multiselect
							? []
							: def?.type === 'url'
								? { display_name: '', url: '' }
								: '';
	});

	function handleRecordClick(item: ImageListItem) {
		if (selection.gridSelectMode) {
			selection.toggleMultiselect(item.id);
		} else {
			selection.setGridViewActive(false);
			selection.selectImage(item.id);
		}
	}

	function toggleSelectMode() {
		selection.setGridSelectMode(!selection.gridSelectMode);
	}

	async function handleDeleteRecords() {
		const ids = [...selection.multiselectedIds];
		if (ids.length === 0 || !typeId) return;
		try {
			for (const id of ids) {
				await apiDeleteRecordForType(typeId, id);
			}
			toast.success(`Deleted ${ids.length} record${ids.length === 1 ? '' : 's'}`);
			deleteConfirmOpen = false;
			selection.clearMultiselect();
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Delete failed');
		}
	}

	function formatGroupLabel(key: string): string {
		if (key === '__empty__') return '(empty)';
		try {
			const v = JSON.parse(key);
			return Array.isArray(v) ? v.join(', ') : String(v);
		} catch {
			return key;
		}
	}

	const groupedSections = $derived.by(() => {
		const field = selection.gridGroupByField;
		const items = selection.visibleImageItems;
		if (!field || items.length === 0) {
			return items.length ? [{ label: null as string | null, items }] : [];
		}
		const map = new Map<string, ImageListItem[]>();
		for (const item of items) {
			const v = (item as ImageListItem & { group_by_value?: unknown }).group_by_value;
			const key = v === undefined || v === null ? '__empty__' : JSON.stringify(v);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(item);
		}
		return [...map.entries()].map(([key, groupItems]) => ({
			label: formatGroupLabel(key),
			items: groupItems
		})).sort((a, b) => {
			if (a.label === '(empty)') return -1;
			if (b.label === '(empty)') return 1;
			return (a.label ?? '').localeCompare(b.label ?? '');
		});
	});
</script>

<div class="flex flex-col h-full w-full">
	<div class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border shrink-0 bg-background">
		<div class="flex items-center gap-2 flex-wrap">
			<Button
				variant={selection.gridSelectMode ? 'default' : 'outline'}
				size="sm"
				onclick={toggleSelectMode}
			>
				{#if selection.gridSelectMode}
					<CheckSquare class="h-4 w-4 mr-1" />
					Select
				{:else}
					<Square class="h-4 w-4 mr-1" />
					Select
				{/if}
			</Button>
			{#if selection.gridSelectMode && selection.multiselectedIds.length > 0}
				<Button variant="ghost" size="sm" onclick={() => { selection.clearMultiselect(); selection.setGridSelectMode(false); }}>
					Done
				</Button>
			{/if}
			<div class="flex items-center gap-2">
				<Label for="grid-group-by" class="text-sm text-muted-foreground whitespace-nowrap">Group by</Label>
				<Select.Root type="single" bind:value={groupByValue}>
					<Select.Trigger id="grid-group-by" class="w-[140px]">
						{groupByValue ? fieldLabel(groupByValue) : 'None'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">None</Select.Item>
						{#each gridSchemaFields as key}
							<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-center gap-2">
				<Label for="grid-size" class="text-sm text-muted-foreground whitespace-nowrap">Size</Label>
				<Select.Root
					type="single"
					bind:value={gridSizeOption}
					onValueChange={(v) => {
						if (v != null && (v === 'small' || v === 'medium' || v === 'large')) {
							gridSizeOption = v;
							selection.setGridSize(v);
							settingsStore.updateSetting('gridSize', v);
						}
					}}
				>
					<Select.Trigger id="grid-size" class="w-[100px]">
						{gridSizeOption === 'small' ? 'Small' : gridSizeOption === 'large' ? 'Large' : 'Medium'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="small">Small</Select.Item>
						<Select.Item value="medium">Medium</Select.Item>
						<Select.Item value="large">Large</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		{#if selection.multiselectedIds.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">
					{selection.multiselectedIds.length} selected
				</span>
				<Button variant="outline" size="sm" onclick={openSetFieldDialog}>
					Set field…
				</Button>
				<Button
					variant="destructive"
					size="sm"
					onclick={() => (deleteConfirmOpen = true)}
				>
					<Trash2 class="h-4 w-4 mr-1" />
					Delete
				</Button>
			</div>
		{/if}
	</div>

	<AlertDialog.Root bind:open={deleteConfirmOpen}>
		<AlertDialog.Content>
			{@const count = selection.multiselectedIds.length}
			<AlertDialog.Title>Delete records</AlertDialog.Title>
			<AlertDialog.Description>
				Delete {count} record{count === 1 ? '' : 's'}? This cannot be undone.
			</AlertDialog.Description>
			<div class="flex justify-end gap-2 mt-4">
				<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
				<Button variant="destructive" type="button" onclick={handleDeleteRecords}>
					Delete
				</Button>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<Dialog.Root bind:open={setFieldDialogOpen}>
		<Dialog.Content>
			<Dialog.Title>Set field for selected records</Dialog.Title>
			<Dialog.Description>
				Choose a field and value. This will update all {selection.multiselectedIds.length} selected record{selection.multiselectedIds.length === 1 ? '' : 's'}.
			</Dialog.Description>
			{#if setFieldSchema}
				<div class="flex flex-col gap-4 py-4">
					<div class="flex flex-col gap-2">
						<Label for="set-field-key">Field</Label>
						<Select.Root type="single" bind:value={setFieldKey}>
							<Select.Trigger id="set-field-key" class="w-full">
								{setFieldKey ? fieldLabel(setFieldKey) : 'Select field'}
							</Select.Trigger>
							<Select.Content>
								{#each getOrderedEditableKeys(setFieldSchema) as key}
									<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					{#if setFieldKey}
						{@const def = setFieldSchema[setFieldKey]}
						{@const type = def?.type ?? 'string'}
						<div class="flex flex-col gap-2">
							<Label for="set-field-value">Value</Label>
							{#if type === 'boolean'}
								<div class="flex items-center gap-2">
									<Checkbox
										id="set-field-value"
										checked={typeof setFieldValue === 'boolean' ? setFieldValue : false}
										onchange={(e) => (setFieldValue = (e.target as HTMLInputElement).checked)}
									/>
									<Label for="set-field-value" class="font-normal">{(def?.type === 'boolean' && setFieldValue) ? 'Yes' : 'No'}</Label>
								</div>
							{:else if type === 'dropdown' && def?.options?.length}
								{#if (def as { multiselect?: boolean }).multiselect}
									<Select.Root
										type="multiple"
										value={(Array.isArray(setFieldValue) ? setFieldValue : []) as string[]}
										onValueChange={(v) => (setFieldValue = v ?? [])}
									>
										<Select.Trigger id="set-field-value" class="w-full">
											{(Array.isArray(setFieldValue) ? setFieldValue : []).length === 0
												? '(none)'
												: (Array.isArray(setFieldValue) ? setFieldValue : []).join(', ')}
										</Select.Trigger>
										<Select.Content>
											{#each def.options ?? [] as opt}
												<Select.Item value={opt}>{opt}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{:else}
									<Select.Root
										type="single"
										value={typeof setFieldValue === 'string' ? setFieldValue : ''}
										onValueChange={(v) => (setFieldValue = v ?? '')}
									>
										<Select.Trigger id="set-field-value" class="w-full">
											{(typeof setFieldValue === 'string' && setFieldValue) || '(none)'}
										</Select.Trigger>
										<Select.Content>
											{#each def.options ?? [] as opt}
												<Select.Item value={opt}>{opt}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
							{:else if type === 'number'}
								<Input
									id="set-field-value"
									type="number"
									value={typeof setFieldValue === 'number' ? setFieldValue : setFieldValue === '' ? '' : Number(setFieldValue)}
									oninput={(e) => (setFieldValue = (e.currentTarget as HTMLInputElement).valueAsNumber ?? 0)}
								/>
							{:else if type === 'list'}
								<Input
									id="set-field-value"
									type="text"
									placeholder="Comma-separated values"
									value={Array.isArray(setFieldValue) ? setFieldValue.join(', ') : String(setFieldValue ?? '')}
									oninput={(e) => (setFieldValue = (e.currentTarget as HTMLInputElement).value)}
								/>
							{:else if type === 'url'}
								{@const urlObj = setFieldValue != null && typeof setFieldValue === 'object' && 'url' in setFieldValue ? (setFieldValue as { display_name: string; url: string }) : { display_name: '', url: '' }}
								<div class="flex flex-col gap-2">
									<Input
										type="text"
										placeholder="Display name"
										value={urlObj.display_name ?? ''}
										oninput={(e) => (setFieldValue = { ...urlObj, display_name: (e.target as HTMLInputElement).value })}
									/>
									<Input
										type="url"
										placeholder="https://..."
										value={urlObj.url ?? ''}
										oninput={(e) => (setFieldValue = { ...urlObj, url: (e.target as HTMLInputElement).value })}
									/>
								</div>
							{:else}
								<Input
									id="set-field-value"
									type="text"
									value={String(setFieldValue ?? '')}
									oninput={(e) => (setFieldValue = (e.target as HTMLInputElement).value)}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
			<div class="flex justify-end gap-2">
				<Dialog.Close type="button">Cancel</Dialog.Close>
				<Button type="button" onclick={handleSetFieldSubmit}>
					Apply
				</Button>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<div class="flex-1 overflow-auto p-4">
		{#if groupedSections.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-muted-foreground italic">
				No records to display.
			</div>
		{:else}
			{#each groupedSections as section}
				<div class="mb-6">
					{#if section.label !== null}
						<h3 class="text-sm font-semibold text-muted-foreground mb-2">
							{selection.gridGroupByField ? fieldLabel(selection.gridGroupByField) + ': ' : ''}{section.label}
						</h3>
					{/if}
					<div
						class="grid gap-3"
						style="grid-template-columns: repeat(auto-fill, minmax({gridMinPx}px, 1fr))"
					>
						{#each section.items as item (item.id)}
							{@const isSelected = selection.multiselectedIds.includes(item.id)}
							<button
								type="button"
								class="relative flex flex-col rounded-lg overflow-hidden border-2 transition-colors focus:outline-none focus:ring-0 {isSelected
									? 'border-primary bg-primary/10'
									: 'border-transparent hover:border-muted-foreground/30 hover:bg-muted/50'}"
								onclick={() => handleRecordClick(item)}
							>
								<div class="aspect-square w-full bg-muted flex items-center justify-center overflow-hidden p-2">
									<span class="text-sm font-medium text-center line-clamp-4">
										{getDisplayName(item)}
									</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
