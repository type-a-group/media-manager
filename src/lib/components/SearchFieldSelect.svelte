<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';

	/**
	 * The "search which field" picker that sits directly under {@link SearchBox} in both rails. Lets
	 * the user scope the search to one field, defaulting to **All fields** (value `''`). Shared so Files
	 * and Records present an identical control.
	 *
	 * - Records feeds it every user field of the active type.
	 * - Files feeds it the fields of the single/intersected class(es), else just `Filename`.
	 *
	 * The trigger label is `truncate`d and width-capped so a long field name can never clip out of the
	 * control (an explicit requirement).
	 *
	 * @param fields - Selectable `{ key, label }` fields (excluding the All-fields sentinel).
	 * @param value - Bindable selected field key; `''` means "All fields".
	 * @param allLabel - Label for the All-fields option (default "All fields").
	 * @param disabled - Disable the control (e.g. nothing meaningful to scope to).
	 */
	let {
		fields = [],
		value = $bindable(''),
		allLabel = 'All fields',
		disabled = false
	}: {
		fields?: { key: string; label: string }[];
		value?: string;
		allLabel?: string;
		disabled?: boolean;
	} = $props();

	const selectedLabel = $derived(
		value ? (fields.find((f) => f.key === value)?.label ?? value) : allLabel
	);
</script>

<Select.Root type="single" {value} onValueChange={(v) => (value = v ?? '')} {disabled}>
	<Select.Trigger class="h-8 w-full text-sm">
		<span class="block truncate text-left">{selectedLabel}</span>
	</Select.Trigger>
	<Select.Content>
		<Select.Item value="">{allLabel}</Select.Item>
		{#each fields as f (f.key)}
			<Select.Item value={f.key}>{f.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
