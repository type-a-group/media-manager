<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	/**
	 * The shared **empty / incomplete quick-filter** (Item 10) for the rail filter section. Two
	 * composable shapes, both ANDing with the host's search + other filters server-side:
	 *
	 * 1. **Incomplete only** — a checkbox that keeps records with *any* empty user field (the host maps
	 *    this to the `incomplete` flag on the list call).
	 * 2. **`<field> is empty`** — a per-field picker the host maps to a single
	 *    `{ field, operator: 'is_empty' }` clause on the existing `filters` param.
	 *
	 * Surfaced identically on the Records rail and the single-class Files catalog rail — don't fork per
	 * surface. The host owns persistence/re-query: bind `incomplete`/`emptyField`, react in an
	 * `$effect`, and use {@link onchange} to trigger a reload. The field list is host-supplied so each
	 * surface offers only the fields it actually has.
	 *
	 * @param fields - Selectable `{ key, label }` user fields for the per-field picker.
	 * @param incomplete - Bindable "Incomplete only" toggle (any empty user field).
	 * @param emptyField - Bindable per-field key; `''` = picker off (no per-field empty clause).
	 * @param onchange - Called after the user changes either control (host persists/reloads).
	 */
	let {
		fields = [],
		incomplete = $bindable(false),
		emptyField = $bindable(''),
		onchange
	}: {
		fields?: { key: string; label: string }[];
		incomplete?: boolean;
		emptyField?: string;
		onchange?: () => void;
	} = $props();

	const NONE = '__none__';
	const selectedLabel = $derived(
		emptyField ? (fields.find((f) => f.key === emptyField)?.label ?? emptyField) : '—'
	);

	function toggleIncomplete(c: boolean | 'indeterminate') {
		incomplete = c === true;
		onchange?.();
	}

	function setEmptyField(v: string | undefined) {
		emptyField = !v || v === NONE ? '' : v;
		onchange?.();
	}
</script>

<div class="flex flex-col gap-2">
	<span class="text-xs font-medium uppercase text-muted-foreground">Show</span>
	<div class="flex items-center gap-2">
		<Checkbox id="filter-incomplete" checked={incomplete} onCheckedChange={toggleIncomplete} />
		<Label for="filter-incomplete" class="text-sm font-normal">Incomplete only</Label>
	</div>
	<div class="flex items-center gap-1.5 text-sm">
		<span class="shrink-0 text-muted-foreground">Field</span>
		<Select.Root
			type="single"
			value={emptyField || NONE}
			onValueChange={setEmptyField}
			disabled={fields.length === 0}
		>
			<Select.Trigger class="h-8 min-w-0 flex-1 text-sm">
				<span class="block truncate text-left">{selectedLabel}</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value={NONE}>—</Select.Item>
				{#each fields as f (f.key)}
					<Select.Item value={f.key}>{f.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<span class="shrink-0 text-muted-foreground">is empty</span>
	</div>
</div>
