<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Trash2 } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { apiListMediaTypes } from '$lib/api/client.js';

	type ValueKind =
		| 'string'
		| 'number'
		| 'boolean'
		| 'dropdown'
		| 'list'
		| 'url'
		| 'file'
		| 'record';
	type ItemType = 'string' | 'number' | 'url';
	type FieldMeta = {
		options?: string[];
		multiselect?: boolean;
		itemType?: ItemType;
		recordType?: string;
	};
	type SectionOption = { id: string; name: string };

	/**
	 * The per-field structure editor for the Globals sectioned editor — type, type-specific config
	 * (dropdown options/multiselect, list item-type), section placement, rename, and delete — inside a
	 * single shadcn Popover. The *same* component backs **+ Add field** (`mode="add"`), where the inputs
	 * stay local until the user commits; in `mode="edit"` every change is applied live through the
	 * granular callbacks so the host's autosave picks it up immediately (rename commits on blur/Enter).
	 *
	 * Field *values* are never edited here — that is `FieldInput` in the row. This menu owns only the
	 * field's shape and placement.
	 *
	 * @param mode - `edit` mutates an existing field live; `add` collects a new field then calls `onAdd`.
	 * @param trigger - Snippet rendering the popover trigger (the row `⋮` button or the add button).
	 * @param sections - All sections, for the placement Select.
	 */
	let {
		mode,
		trigger,
		sections,
		fieldKey = '',
		kind = 'string',
		meta = {},
		sectionId = '',
		defaultSectionId = '',
		onRename,
		onTypeChange,
		onMetaChange,
		onMoveToSection,
		onDelete,
		onAdd
	}: {
		mode: 'edit' | 'add';
		trigger: Snippet;
		sections: SectionOption[];
		fieldKey?: string;
		kind?: ValueKind;
		meta?: FieldMeta;
		sectionId?: string;
		defaultSectionId?: string;
		onRename?: (oldKey: string, newKey: string) => boolean;
		onTypeChange?: (key: string, kind: ValueKind) => void;
		onMetaChange?: (key: string, meta: FieldMeta) => void;
		onMoveToSection?: (key: string, sectionId: string) => void;
		onDelete?: (key: string) => void;
		onAdd?: (field: {
			key: string;
			kind: ValueKind;
			meta: FieldMeta;
			sectionId: string;
		}) => boolean;
	} = $props();

	const KINDS: ValueKind[] = [
		'string',
		'number',
		'boolean',
		'dropdown',
		'list',
		'url',
		'file',
		'record'
	];
	const ITEM_TYPES: ItemType[] = ['string', 'number', 'url'];

	/** Selectable target record types for a `record` field (json types, excluding globals). */
	let recordTypes = $state<{ id: string; displayName: string }[]>([]);
	const recordTypeLabel = $derived((id: string) =>
		id ? (recordTypes.find((t) => t.id === id)?.displayName ?? id) : ''
	);
	onMount(async () => {
		try {
			const types = await apiListMediaTypes();
			recordTypes = types
				.filter((t) => t.kind === 'json' && t.id !== 'globals')
				.map((t) => ({ id: t.id, displayName: t.displayName }));
		} catch (e) {
			console.error('FieldMenu: failed to load record types', e);
		}
	});

	let open = $state(false);

	// Local editing state. For `add` these are the whole form; for `edit` they seed the inputs and are
	// kept in sync so reopening the popover reflects committed changes.
	let nameInput = $state('');
	let kindLocal = $state<ValueKind>('string');
	let optionsCsv = $state('');
	let multiselect = $state(false);
	let itemType = $state<ItemType>('string');
	let recordType = $state('');
	let sectionLocal = $state('');

	/** (Re)seed the local form from props whenever the popover opens. */
	function seed() {
		nameInput = mode === 'edit' ? fieldKey : '';
		kindLocal = mode === 'edit' ? kind : 'string';
		optionsCsv = (meta.options ?? []).join(', ');
		multiselect = meta.multiselect === true;
		itemType = meta.itemType ?? 'string';
		recordType = meta.recordType ?? '';
		sectionLocal = mode === 'edit' ? sectionId : defaultSectionId || sections[0]?.id || '';
	}

	$effect(() => {
		if (open) seed();
	});

	function parseOptions(csv: string): string[] {
		return csv
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}

	/** Current meta derived from the local form (shared by live-edit pushes and add-submit). */
	function buildMeta(): FieldMeta {
		const m: FieldMeta = {};
		if (kindLocal === 'dropdown') {
			const opts = parseOptions(optionsCsv);
			if (opts.length) m.options = opts;
			if (multiselect) m.multiselect = true;
		} else if (kindLocal === 'list') {
			m.itemType = itemType;
		} else if (kindLocal === 'record') {
			if (recordType) m.recordType = recordType;
			if (multiselect) m.multiselect = true;
		} else if (kindLocal === 'file') {
			if (multiselect) m.multiselect = true;
		}
		return m;
	}

	// --- edit-mode live handlers ---
	function commitRename() {
		const next = nameInput.trim();
		if (mode !== 'edit' || !next || next === fieldKey) {
			nameInput = fieldKey;
			return;
		}
		const ok = onRename?.(fieldKey, next) ?? false;
		if (!ok) nameInput = fieldKey; // rejected (reserved/collision) — restore
	}

	function changeType(v: ValueKind) {
		kindLocal = v;
		if (mode === 'edit') {
			onTypeChange?.(fieldKey, v);
			onMetaChange?.(fieldKey, buildMeta());
		}
	}

	function pushMeta() {
		if (mode === 'edit') onMetaChange?.(fieldKey, buildMeta());
	}

	function changeSection(v: string) {
		sectionLocal = v;
		if (mode === 'edit') onMoveToSection?.(fieldKey, v);
	}

	function submitAdd() {
		const key = nameInput.trim();
		if (!key) return;
		if (kindLocal === 'record' && !recordType) return; // a record field needs a target type
		const ok =
			onAdd?.({ key, kind: kindLocal, meta: buildMeta(), sectionId: sectionLocal }) ?? false;
		if (ok) open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{@render trigger()}
	</Popover.Trigger>
	<Popover.Content class="w-80 space-y-3" align="end">
		<!-- Name -->
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">Name</Label>
			<Input
				placeholder="field_key"
				bind:value={nameInput}
				onblur={commitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						mode === 'add' ? submitAdd() : commitRename();
					}
				}}
			/>
		</div>

		<!-- Type -->
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">Type</Label>
			<Select.Root
				type="single"
				value={kindLocal}
				onValueChange={(v) => v && changeType(v as ValueKind)}
			>
				<Select.Trigger class="w-full">{kindLocal}</Select.Trigger>
				<Select.Content>
					{#each KINDS as k (k)}
						<Select.Item value={k}>{k}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<!-- Type-specific config -->
		{#if kindLocal === 'dropdown'}
			<div class="space-y-2">
				<div class="space-y-1">
					<Label class="text-xs text-muted-foreground">Options (comma-separated)</Label>
					<Input
						placeholder="one, two, three"
						bind:value={optionsCsv}
						oninput={pushMeta}
						onblur={pushMeta}
					/>
				</div>
				<div class="flex items-center gap-2">
					<Checkbox
						id="fieldmenu-multi"
						checked={multiselect}
						onCheckedChange={(c) => {
							multiselect = c === true;
							pushMeta();
						}}
					/>
					<Label for="fieldmenu-multi" class="text-sm font-normal">Allow multiple</Label>
				</div>
			</div>
		{:else if kindLocal === 'list'}
			<div class="space-y-1">
				<Label class="text-xs text-muted-foreground">Item type</Label>
				<Select.Root
					type="single"
					value={itemType}
					onValueChange={(v) => {
						if (v) {
							itemType = v as ItemType;
							pushMeta();
						}
					}}
				>
					<Select.Trigger class="w-full">{itemType}</Select.Trigger>
					<Select.Content>
						{#each ITEM_TYPES as t (t)}
							<Select.Item value={t}>{t}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
		{#if kindLocal === 'record'}
			<div class="space-y-1">
				<Label class="text-xs text-muted-foreground">Record type</Label>
				<Select.Root
					type="single"
					value={recordType}
					onValueChange={(v) => {
						if (v) {
							recordType = v;
							pushMeta();
						}
					}}
				>
					<Select.Trigger class="w-full">{recordTypeLabel(recordType) || 'Select…'}</Select.Trigger>
					<Select.Content>
						{#if recordTypes.length === 0}
							<div class="px-2 py-1.5 text-sm text-muted-foreground">No record types yet</div>
						{:else}
							{#each recordTypes as t (t.id)}
								<Select.Item value={t.id}>{t.displayName}</Select.Item>
							{/each}
						{/if}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}
		{#if kindLocal === 'file' || kindLocal === 'record'}
			<div class="flex items-center gap-2">
				<Checkbox
					id="fieldmenu-multi-ref"
					checked={multiselect}
					onCheckedChange={(c) => {
						multiselect = c === true;
						pushMeta();
					}}
				/>
				<Label for="fieldmenu-multi-ref" class="text-sm font-normal">Allow multiple</Label>
			</div>
		{/if}

		<!-- Section placement -->
		{#if sections.length > 0}
			<div class="space-y-1">
				<Label class="text-xs text-muted-foreground">Section</Label>
				<Select.Root
					type="single"
					value={sectionLocal}
					onValueChange={(v) => v && changeSection(v)}
				>
					<Select.Trigger class="w-full">
						{sections.find((s) => s.id === sectionLocal)?.name ?? 'Select…'}
					</Select.Trigger>
					<Select.Content>
						{#each sections as s (s.id)}
							<Select.Item value={s.id}>{s.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		<!-- Footer -->
		{#if mode === 'add'}
			<div class="flex justify-end gap-2 pt-1">
				<Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
				<Button
					size="sm"
					onclick={submitAdd}
					disabled={!nameInput.trim() || (kindLocal === 'record' && !recordType)}
				>
					Add field
				</Button>
			</div>
		{:else}
			<div class="flex items-center justify-between pt-1">
				<AlertDialog.Root>
					<AlertDialog.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="sm"
								class="text-destructive hover:text-destructive"
							>
								<Trash2 class="mr-1 size-4" /> Delete
							</Button>
						{/snippet}
					</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Delete “{fieldKey}”?</AlertDialog.Title>
							<AlertDialog.Description>
								This removes the field and its value from globals. This can't be undone.
							</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
							<AlertDialog.Action
								onclick={() => {
									onDelete?.(fieldKey);
									open = false;
								}}
							>
								Delete
							</AlertDialog.Action>
						</AlertDialog.Footer>
					</AlertDialog.Content>
				</AlertDialog.Root>
				<Button variant="outline" size="sm" onclick={() => (open = false)}>Done</Button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
