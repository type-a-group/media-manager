<script lang="ts">
	import type { FieldDefinition, UrlValue } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import { apiBlobUrl } from '$lib/api/files.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	/**
	 * A single schema-driven field input for the per-file class editor. Supports every FieldType:
	 * string / number / boolean / dropdown (single + multiselect) / list / url / file.
	 *
	 * All controls are shadcn-svelte primitives (Input/Checkbox/Select/Button) per the UI convention.
	 */
	let {
		def,
		value = $bindable(),
		fileOptions = [],
		missing = false
	}: {
		def: FieldDefinition;
		value: unknown;
		/** Available blobs for `file`-type fields: { id, name }. */
		fileOptions?: { id: string; name: string }[];
		missing?: boolean;
	} = $props();

	const url = $derived(
		def.type === 'url' ? normalizeUrlValue(value) : { display_name: '', url: '' }
	);

	function setUrl(patch: Partial<UrlValue>) {
		value = { ...url, ...patch };
	}

	let listText = $derived(
		def.type === 'list' && Array.isArray(value)
			? (value as unknown[])
					.map((v) => (typeof v === 'object' && v && 'url' in v ? (v as UrlValue).url : String(v)))
					.join(', ')
			: ''
	);

	function setList(text: string) {
		value = text
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}

	const multiselect = $derived(
		def.type === 'dropdown' && (def as { multiselect?: boolean }).multiselect
	);

	/** Per-instance id base so multiselect checkbox/label pairs associate without colliding. */
	const uid = `cfi-${Math.random().toString(36).slice(2, 9)}`;

	/** Current string value (used by dropdown/file single-selects). */
	const stringValue = $derived(typeof value === 'string' ? value : '');
	/** Display label for the file-reference select trigger. */
	const fileLabel = $derived(fileOptions.find((f) => f.id === stringValue)?.name ?? '— none —');
</script>

{#if def.type === 'boolean'}
	<Checkbox checked={value === true} onCheckedChange={(v) => (value = v)} />
{:else if def.type === 'number'}
	<Input
		type="number"
		value={typeof value === 'number' ? value : ''}
		oninput={(e) => (value = e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value))}
	/>
{:else if def.type === 'dropdown'}
	{#if multiselect}
		<div class="flex flex-wrap gap-3">
			{#each def.options ?? [] as opt, i (opt)}
				<div class="flex items-center gap-1.5 text-sm">
					<Checkbox
						id={`${uid}-${i}`}
						checked={Array.isArray(value) && (value as string[]).includes(opt)}
						onCheckedChange={(checked) => {
							const set = new Set(Array.isArray(value) ? (value as string[]) : []);
							if (checked) set.add(opt);
							else set.delete(opt);
							value = [...set];
						}}
					/>
					<Label for={`${uid}-${i}`} class="font-normal">{opt}</Label>
				</div>
			{/each}
		</div>
	{:else}
		<Select.Root type="single" value={stringValue} onValueChange={(v) => (value = v)}>
			<Select.Trigger class="w-full">{stringValue || 'Select…'}</Select.Trigger>
			<Select.Content>
				{#each def.options ?? [] as opt (opt)}
					<Select.Item value={opt}>{opt}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
{:else if def.type === 'list'}
	<Input
		placeholder="comma, separated, values"
		value={listText}
		oninput={(e) => setList(e.currentTarget.value)}
	/>
{:else if def.type === 'url'}
	<div class="flex gap-2">
		<Input
			class="w-1/3"
			placeholder="label"
			value={url.display_name}
			oninput={(e) => setUrl({ display_name: e.currentTarget.value })}
		/>
		<Input
			class="flex-1"
			placeholder="https://…"
			value={url.url}
			oninput={(e) => setUrl({ url: e.currentTarget.value })}
		/>
	</div>
{:else if def.type === 'file'}
	<div class="flex items-center gap-2">
		<Select.Root type="single" value={stringValue} onValueChange={(v) => (value = v)}>
			<Select.Trigger class="flex-1 {missing ? 'border-destructive' : ''}"
				>{fileLabel}</Select.Trigger
			>
			<Select.Content>
				<Select.Item value="">— none —</Select.Item>
				{#each fileOptions as f (f.id)}
					<Select.Item value={f.id}>{f.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if stringValue && !missing}
			<Button
				variant="link"
				size="sm"
				href={apiBlobUrl(stringValue)}
				target="_blank"
				rel="noreferrer">open</Button
			>
		{/if}
		{#if missing}<span class="text-xs text-destructive">missing</span>{/if}
	</div>
{:else}
	<Input type="text" value={stringValue} oninput={(e) => (value = e.currentTarget.value)} />
{/if}
