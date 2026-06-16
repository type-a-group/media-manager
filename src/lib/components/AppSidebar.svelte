<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/sidebar/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { ChevronsUpDownIcon, Home, LayoutGrid, Plus, RefreshCwIcon } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import SettingsButton from './SettingsButton.svelte';
	import SchemaEditorButton from './SchemaEditorButton.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { TOOLTIP_DELAY_MS } from '$lib/utils.js';
	import type { ImageListItem, SchemaDefinition } from '$lib/core/types.js';
	import {
		getOperatorsForFieldType,
		OPERATOR_LABELS,
		VALUE_LESS_OPERATORS,
		OPERATORS,
		type OperatorId
	} from '$lib/core/filters.js';
	import {
		apiCreateRecordForType,
		apiGetSchemaForType,
		apiListRecordsForType
	} from '$lib/api/client.js';
	import { refreshTrigger, schemaRefreshTrigger } from '$lib/stores/refreshTrigger.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { isUserFieldKey } from '$lib/core/fieldKeys.js';
	import { useSelection } from '$lib/state/selection.svelte';

	/**
	 * The shared shell for `/media/[typeId]` — a `json` record type (or the reserved `globals`
	 * singleton). Lists records with a multi-filter panel, a filename/name search, a grid-view
	 * toggle, and a "New record" action. (The legacy image/blob-store machinery — upload,
	 * linked/unlinked/excluded — was retired with the file-first model; blobs live in `/files`.)
	 */
	let records = $state<ImageListItem[]>([]);
	let loading = $state(true);

	// NOTE: This is a class instance; do not destructure it or you’ll capture initial values.
	const selection = useSelection();

	let { collapsed = $bindable() } = $props();

	/** Multi-filter rows: field, operator, optional value; enabled (default true) toggles whether the filter is applied. */
	type FilterRow = {
		field: string;
		operator: string;
		value?: string | number | boolean;
		enabled?: boolean;
	};
	let filters = $state<FilterRow[]>([]);
	let schema = $state<SchemaDefinition | null>(null);
	let schemaFields = $state<string[]>([]);

	/** Current media type from store (set by /media/[typeId] page). */
	const currentMediaType = $derived($currentMediaTypeStore);
	const typeId = $derived(currentMediaType?.typeId ?? null);
	const isGlobals = $derived(typeId === 'globals');

	// The records actually displayed in the sidebar (after the local search filter).
	let displayedItems = $state<ImageListItem[]>([]);
	let searchQuery = $state('');

	/**
	 * Fetches the schema from the API and updates schemaFields for filter field dropdowns.
	 * Full schema is stored for operator/value type-aware UI.
	 */
	async function fetchSchema() {
		if (!typeId) return;
		try {
			const s = await apiGetSchemaForType(typeId);
			schema = s;
			schemaFields = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
			await fetchRecords();
		} catch (error) {
			console.error('Error fetching schema:', error);
		}
	}

	/** Display name for a record: name, then group_by_value, then short id. */
	function getDisplayName(
		item: ImageListItem & {
			name?: string;
			group_by_value?: string | number | boolean | string[] | null;
		}
	): string {
		const jsonName = (item as { name?: string }).name?.trim();
		if (jsonName && jsonName.length > 0) return jsonName;
		if (item.group_by_value != null && item.group_by_value !== '')
			return String(item.group_by_value);
		return (item.id as string).slice(0, 8);
	}

	/**
	 * Builds API filter clauses from UI filter rows: only enabled rows with field and operator set;
	 * value omitted for is_empty / is_not_empty.
	 */
	function buildFiltersForApi(): {
		field: string;
		operator: string;
		value?: string | number | boolean;
	}[] {
		return filters
			.filter((row) => row.enabled !== false && row.field && row.operator)
			.map((row) => {
				const omitValue = VALUE_LESS_OPERATORS.has(row.operator);
				return {
					field: row.field,
					operator: row.operator,
					...(omitValue ? {} : { value: row.value })
				};
			});
	}

	/** Fetch the record list for the current type, honoring the multi-filter state. */
	async function fetchRecords() {
		if (!typeId || isGlobals) return;
		loading = true;
		try {
			const apiFilters = buildFiltersForApi();
			const data = await apiListRecordsForType(typeId, {
				...(apiFilters.length > 0 ? { filters: apiFilters } : {}),
				groupBy: selection.gridGroupByField ?? undefined
			});
			records = 'records' in data ? (data.records as ImageListItem[]) : [];
			updateDisplayedItems();
		} catch (error) {
			console.error('Error fetching records:', error);
		}
		loading = false;
	}

	/**
	 * Applies the local search filter and updates the shared `visibleImage*` state for navigation.
	 */
	function updateDisplayedItems() {
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			displayedItems = records.filter((item) => {
				const dn = getDisplayName(item).toLowerCase();
				const fn = (item.file_name ?? '').toLowerCase();
				return dn.includes(q) || fn.includes(q);
			});
		} else {
			displayedItems = records;
		}

		selection.setVisibleImageIds(displayedItems.map((i) => i.id));
		selection.setVisibleImageItems(displayedItems);
	}

	// When searchQuery changes, update displayed list + shared navigation IDs.
	$effect(() => {
		const _q = searchQuery;
		updateDisplayedItems();
	});

	$effect(() => {
		if (typeId) fetchSchema();
	});

	$effect(() => {
		const _t = typeId;
		const _filters = filters;
		const _groupBy = selection.gridGroupByField;
		if (typeId) fetchRecords();
	});

	$effect(() => {
		let prev = 0;
		const unsub = refreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				fetchRecords();
			}
		});
		return unsub;
	});

	$effect(() => {
		let prev = 0;
		const unsub = schemaRefreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				fetchSchema();
			}
		});
		return unsub;
	});

	/**
	 * Resolves schema field type for a field key. Unknown keys default to 'string'.
	 */
	function getFieldTypeForField(
		fieldKey: string
	): 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' {
		if (!schema) return 'string';
		const def = schema[fieldKey];
		if (def?.type) return def.type as 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url';
		return 'string';
	}

	/** Returns operator IDs for the given field key (used for operator dropdown). */
	function operatorsForField(fieldKey: string): OperatorId[] {
		return getOperatorsForFieldType(getFieldTypeForField(fieldKey));
	}

	/** Adds a new filter row with default field and operator. */
	function addFilter() {
		const field = schemaFields[0] ?? 'name';
		const ops = operatorsForField(field);
		filters = [
			...filters,
			{ field, operator: ops[0] ?? OPERATORS.contains, value: '', enabled: true }
		];
	}

	/** Removes the filter row at index. */
	function removeFilter(index: number) {
		filters = filters.filter((_, i) => i !== index);
	}

	/** Clears all filter rows. */
	function clearAllFilters() {
		filters = [];
	}

	/** When field changes on a row, reset operator to first valid and clear value if needed. */
	function onFilterFieldChange(index: number, newField: string) {
		const ops = operatorsForField(newField);
		const newOp = ops[0] ?? OPERATORS.contains;
		filters = filters.map((row, i) =>
			i === index ? { ...row, field: newField, operator: newOp, value: row.value } : row
		);
	}

	/** When operator changes, clear value for value-less operators. */
	function onFilterOperatorChange(index: number, newOperator: string) {
		filters = filters.map((row, i) =>
			i === index
				? {
						...row,
						operator: newOperator,
						value: VALUE_LESS_OPERATORS.has(newOperator) ? undefined : row.value
					}
				: row
		);
	}

	/** Manually refresh the record list using the current filters. */
	async function syncRecords() {
		await fetchRecords();
	}

	async function openImage(item: ImageListItem) {
		await selection.setGridViewActive(false);
		selection.selectImage(item.id);
	}

	/**
	 * Create a new JSON record. Refreshes list then selects the new record so the list and selection
	 * stay in sync and the editor can load the record without racing.
	 */
	async function createRecord() {
		if (!typeId || isGlobals) return;
		try {
			const created = await apiCreateRecordForType(typeId);
			await fetchRecords();
			selection.selectImage(created.id);
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record');
		}
	}

	/** Toggle grid view. When entering grid view, runs save-before-navigate hook then clears selection. */
	async function toggleGridView() {
		await selection.setGridViewActive(!selection.gridViewActive);
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex flex-row items-center gap-2 min-w-0">
			<Sidebar.Trigger class="shrink-0" />
			<h2 class="text-lg font-bold truncate min-w-0">
				{currentMediaType?.displayName ?? typeId ?? 'Media Manager'}
			</h2>
		</div>
		<div class="flex flex-row items-center gap-2 mt-2">
			<Button
				variant="outline"
				size="icon"
				class="h-8 w-8 shrink-0"
				title="Back to all media types"
				onclick={() => goto('/')}
			>
				<Home class="h-4 w-4" />
			</Button>
			{#if !isGlobals}
				<SchemaEditorButton />
				<SettingsButton />
			{/if}
		</div>
		<Sidebar.Separator />
		{#if !isGlobals}
			<Sidebar.Group>
				<Collapsible.Root>
					<div class="flex flex-row gap-2 items-center justify-between">
						<Sidebar.GroupLabel>Filters</Sidebar.GroupLabel>
						<Collapsible.Trigger
							class={buttonVariants({ variant: 'ghost', size: 'sm', class: 'w-9 p-0' })}
						>
							<ChevronsUpDownIcon />
						</Collapsible.Trigger>
					</div>
					<Collapsible.Content>
						<div class="flex flex-col gap-2">
							{#each filters as row, i}
								{@const fieldType = getFieldTypeForField(row.field)}
								{@const ops = operatorsForField(row.field)}
								{@const needsValue = !VALUE_LESS_OPERATORS.has(row.operator)}
								{@const isEnabled = row.enabled !== false}
								<div
									class="flex flex-col gap-1.5 rounded border p-1.5"
									class:opacity-60={!isEnabled}
								>
									<div class="flex flex-row gap-1 items-center">
										<Checkbox
											id="filter-enabled-{i}"
											checked={isEnabled}
											onCheckedChange={(checked) => {
												filters = filters.map((r, j) =>
													j === i ? { ...r, enabled: checked === true } : r
												);
											}}
											aria-label="Enable or disable this filter"
											class="shrink-0"
										/>
										<Select.Root
											type="single"
											value={row.field}
											onValueChange={(v) => v && onFilterFieldChange(i, v)}
										>
											<Select.Trigger class="flex-1 min-w-0 text-xs">
												{row.field || 'Field'}
											</Select.Trigger>
											<Select.Content>
												{#each schemaFields as field}
													<Select.Item value={field}>{field}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
										<Button
											variant="ghost"
											size="icon"
											class="h-8 w-8 shrink-0"
											title="Remove filter"
											onclick={() => removeFilter(i)}
										>
											×
										</Button>
									</div>
									<Select.Root
										type="single"
										value={row.operator}
										onValueChange={(v) => v && onFilterOperatorChange(i, v)}
									>
										<Select.Trigger class="w-full text-xs">
											{OPERATOR_LABELS[row.operator as OperatorId] ?? row.operator}
										</Select.Trigger>
										<Select.Content>
											{#each ops as op}
												<Select.Item value={op}>{OPERATOR_LABELS[op]}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
									{#if needsValue}
										{#if fieldType === 'number'}
											<Input
												type="number"
												class="text-xs h-8"
												placeholder="Value"
												value={row.value === undefined || row.value === null
													? ''
													: String(row.value)}
												oninput={(e) => {
													const v = (e.currentTarget as HTMLInputElement).value;
													const num = v === '' ? undefined : Number(v);
													filters = filters.map((r, j) => (j === i ? { ...r, value: num } : r));
												}}
											/>
										{:else if fieldType === 'boolean'}
											<Select.Root
												type="single"
												value={row.value === true ? 'true' : row.value === false ? 'false' : ''}
												onValueChange={(v) => {
													const val = v === 'true' ? true : v === 'false' ? false : undefined;
													filters = filters.map((r, j) => (j === i ? { ...r, value: val } : r));
												}}
											>
												<Select.Trigger class="w-full text-xs h-8">
													{row.value === true ? 'true' : row.value === false ? 'false' : 'Value'}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="true">true</Select.Item>
													<Select.Item value="false">false</Select.Item>
												</Select.Content>
											</Select.Root>
										{:else if fieldType === 'dropdown' && schema?.[row.field]?.options?.length}
											<Select.Root
												type="single"
												value={typeof row.value === 'string' ? row.value : ''}
												onValueChange={(v) => {
													filters = filters.map((r, j) => (j === i ? { ...r, value: v ?? '' } : r));
												}}
											>
												<Select.Trigger class="w-full text-xs h-8">
													{row.value ?? 'Value'}
												</Select.Trigger>
												<Select.Content>
													{#each schema[row.field]?.options ?? [] as opt}
														<Select.Item value={String(opt)}>{String(opt)}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										{:else}
											<Input
												type="text"
												class="text-xs h-8"
												placeholder="Value"
												value={row.value === undefined || row.value === null
													? ''
													: String(row.value)}
												oninput={(e) => {
													const v = (e.currentTarget as HTMLInputElement).value;
													filters = filters.map((r, j) => (j === i ? { ...r, value: v } : r));
												}}
											/>
										{/if}
									{/if}
								</div>
							{/each}
							<div class="flex flex-row gap-1 flex-wrap">
								<Button variant="outline" size="sm" class="text-xs" onclick={addFilter}>
									Add filter
								</Button>
								{#if filters.length > 0}
									<Button variant="ghost" size="sm" class="text-xs" onclick={clearAllFilters}>
										Clear all
									</Button>
								{/if}
							</div>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
			</Sidebar.Group>
		{/if}
	</Sidebar.Header>

	{#if !isGlobals}
		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>
					<div class="flex items-center justify-between gap-2 w-full">
						<span class="ml-2">Records ({displayedItems.length})</span>
						<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
							<div class="flex items-center gap-2">
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant={selection.gridViewActive ? 'default' : 'ghost'}
												size="icon"
												title="Grid view"
												onclick={toggleGridView}
												disabled={loading}
												class="h-7 w-7"
											>
												<LayoutGrid class="h-4 w-4" />
											</Button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>Grid view</Tooltip.Content>
								</Tooltip.Root>
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="icon"
												title="Reload records"
												onclick={syncRecords}
												disabled={loading}
												class="h-7 w-7"
											>
												<RefreshCwIcon class="h-4 w-4" />
											</Button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>Sync records</Tooltip.Content>
								</Tooltip.Root>
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="outline"
												size="icon"
												title="New record"
												onclick={createRecord}
												disabled={loading}
												class="h-7 w-7"
											>
												<Plus class="h-4 w-4" aria-hidden="true" />
											</Button>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>New record</Tooltip.Content>
								</Tooltip.Root>
							</div>
						</Tooltip.Provider>
					</div>
				</Sidebar.GroupLabel>
				<div class="px-3 pb-2">
					<Input
						type="text"
						placeholder="Search records..."
						bind:value={searchQuery}
						class="h-8 text-xs"
					/>
				</div>
				<ul>
					{#if loading}
						<li class="italic flex justify-center">Loading...</li>
					{:else if displayedItems.length > 0}
						{#each displayedItems as item (item.id)}
							<li>
								<button
									class={buttonVariants({
										variant: selection.selectedImageId === item.id ? 'default' : 'ghost',
										class: 'w-full justify-start focus-visible:ring-0'
									})}
									onclick={() => openImage(item)}
								>
									<span
										class="overflow-x-auto whitespace-nowrap w-full text-left [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
									>
										{getDisplayName(item)}
									</span>
								</button>
							</li>
						{/each}
					{:else}
						<li class="italic flex justify-center">No records found.</li>
					{/if}
				</ul>
			</Sidebar.Group>
		</Sidebar.Content>
	{/if}
</Sidebar.Root>
