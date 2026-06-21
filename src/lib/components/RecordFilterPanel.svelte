<script lang="ts">
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { ChevronsUpDownIcon } from 'lucide-svelte';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { schemaUserFieldKeys } from '$lib/core/fieldKeys.js';
	import {
		getOperatorsForFieldType,
		OPERATOR_LABELS,
		VALUE_LESS_OPERATORS,
		OPERATORS,
		type OperatorId
	} from '$lib/core/filters.js';

	/** A single filter clause; `enabled === false` keeps the row but excludes it from the query. */
	export type FilterRow = {
		field: string;
		operator: string;
		value?: string | number | boolean;
		enabled?: boolean;
	};

	/**
	 * The multi-filter panel for a `json` record type — field/operator/value rows that the host turns
	 * into API filter clauses. Extracted verbatim from the old `AppSidebar` so the records hub and any
	 * future caller share one implementation. The host owns `filters` (bindable) and reacts to changes;
	 * this component only edits the rows.
	 *
	 * @param schema - The type's schema (drives the field list + per-field operator/value widgets).
	 * @param filters - Bindable list of filter rows.
	 */
	let {
		schema = null,
		filters = $bindable([])
	}: {
		schema?: SchemaDefinition | null;
		filters?: FilterRow[];
	} = $props();

	const schemaFields = $derived(schema ? schemaUserFieldKeys(schema) : []);

	/** Resolve a field's schema type (unknown keys default to string). */
	function getFieldTypeForField(
		fieldKey: string
	): 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' {
		const def = schema?.[fieldKey];
		if (def?.type) return def.type as 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url';
		return 'string';
	}

	function operatorsForField(fieldKey: string): OperatorId[] {
		return getOperatorsForFieldType(getFieldTypeForField(fieldKey));
	}

	function addFilter() {
		const field = schemaFields[0] ?? 'name';
		const ops = operatorsForField(field);
		filters = [
			...filters,
			{ field, operator: ops[0] ?? OPERATORS.contains, value: '', enabled: true }
		];
	}

	function removeFilter(index: number) {
		filters = filters.filter((_, i) => i !== index);
	}

	function clearAllFilters() {
		filters = [];
	}

	function onFilterFieldChange(index: number, newField: string) {
		const ops = operatorsForField(newField);
		const newOp = ops[0] ?? OPERATORS.contains;
		filters = filters.map((row, i) =>
			i === index ? { ...row, field: newField, operator: newOp, value: row.value } : row
		);
	}

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
</script>

<Sidebar.Group>
	<Collapsible.Root>
		<div class="flex flex-row items-center justify-between gap-2">
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
					<div class="flex flex-col gap-1.5 rounded border p-1.5" class:opacity-60={!isEnabled}>
						<div class="flex flex-row items-center gap-1">
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
								<Select.Trigger class="min-w-0 flex-1 text-xs">
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
									class="h-8 text-xs"
									placeholder="Value"
									value={row.value === undefined || row.value === null ? '' : String(row.value)}
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
									<Select.Trigger class="h-8 w-full text-xs">
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
									<Select.Trigger class="h-8 w-full text-xs">
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
									class="h-8 text-xs"
									placeholder="Value"
									value={row.value === undefined || row.value === null ? '' : String(row.value)}
									oninput={(e) => {
										const v = (e.currentTarget as HTMLInputElement).value;
										filters = filters.map((r, j) => (j === i ? { ...r, value: v } : r));
									}}
								/>
							{/if}
						{/if}
					</div>
				{/each}
				<div class="flex flex-row flex-wrap gap-1">
					<Button variant="outline" size="sm" class="text-xs" onclick={addFilter}>Add filter</Button
					>
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
