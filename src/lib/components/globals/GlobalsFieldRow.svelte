<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { GripVertical, MoreVertical } from 'lucide-svelte';
	import FieldInput from '../FieldInput.svelte';
	import FieldMenu from './FieldMenu.svelte';
	import type { FieldDefinition } from '$lib/core/types.js';

	type ValueKind =
		| 'string'
		| 'number'
		| 'boolean'
		| 'dropdown'
		| 'list'
		| 'url'
		| 'file'
		| 'record'
		| 'date';
	type ItemType = 'string' | 'number' | 'url';
	type FieldMeta = {
		options?: string[];
		multiselect?: boolean;
		itemType?: ItemType;
		recordType?: string;
	};
	type SectionOption = { id: string; name: string };

	/**
	 * One `key → value` row in the Globals sectioned editor: a drag grip + field name on the left, the
	 * shared {@link FieldInput} value control in the middle, and the per-field `⋮` {@link FieldMenu} on
	 * the right. The row owns no field structure itself — type/options/section/rename/delete all flow
	 * through the menu's callbacks; the value flows through `bind:value`.
	 */
	let {
		fieldKey,
		def,
		value = $bindable(),
		kind,
		meta,
		sectionId,
		sections,
		missing = false,
		missingName,
		onEnterSave,
		onRename,
		onTypeChange,
		onMetaChange,
		onMoveToSection,
		onDelete,
		onDragStart,
		onDragOverRow,
		onDropRow,
		onDragEnd,
		dropIndicator = false
	}: {
		fieldKey: string;
		def: FieldDefinition;
		value: unknown;
		kind: ValueKind;
		meta: FieldMeta;
		sectionId: string;
		sections: SectionOption[];
		missing?: boolean;
		missingName?: string;
		onEnterSave?: () => void;
		onRename?: (oldKey: string, newKey: string) => boolean;
		onTypeChange?: (key: string, kind: ValueKind) => void;
		onMetaChange?: (key: string, meta: FieldMeta) => void;
		onMoveToSection?: (key: string, sectionId: string) => void;
		onDelete?: (key: string) => void;
		onDragStart?: (key: string) => void;
		onDragOverRow?: (key: string, e: DragEvent) => void;
		onDropRow?: (key: string) => void;
		onDragEnd?: () => void;
		dropIndicator?: boolean;
	} = $props();

	let dragging = $state(false);
</script>

<div
	class="group flex items-start gap-2 rounded-md px-1 py-2 transition-colors hover:bg-muted/40 {dropIndicator
		? 'border-t-2 border-primary'
		: 'border-t-2 border-transparent'} {dragging ? 'opacity-50' : ''}"
	role="listitem"
	ondragover={(e) => {
		e.preventDefault();
		onDragOverRow?.(fieldKey, e);
	}}
	ondrop={(e) => {
		e.preventDefault();
		onDropRow?.(fieldKey);
	}}
>
	<!-- Drag grip (only the grip is draggable so text stays selectable) -->
	<button
		type="button"
		class="mt-1.5 cursor-grab text-muted-foreground/40 transition-colors group-hover:text-muted-foreground active:cursor-grabbing"
		draggable="true"
		aria-label="Drag to reorder"
		ondragstart={() => {
			dragging = true;
			onDragStart?.(fieldKey);
		}}
		ondragend={() => {
			dragging = false;
			onDragEnd?.();
		}}
	>
		<GripVertical class="size-4" />
	</button>

	<!-- Field name -->
	<div class="mt-1.5 w-44 shrink-0 truncate text-sm font-semibold" title={fieldKey}>
		{fieldKey}
	</div>

	<!-- Value control -->
	<div class="min-w-0 flex-1">
		<FieldInput {def} bind:value {missing} {missingName} {onEnterSave} />
	</div>

	<!-- Per-field structure menu -->
	<FieldMenu
		mode="edit"
		{fieldKey}
		{kind}
		{meta}
		{sectionId}
		{sections}
		{onRename}
		{onTypeChange}
		{onMetaChange}
		{onMoveToSection}
		{onDelete}
	>
		{#snippet trigger()}
			<Button
				variant="ghost"
				size="icon"
				class="size-8 shrink-0 text-muted-foreground"
				aria-label="Field options"
			>
				<MoreVertical class="size-4" />
			</Button>
		{/snippet}
	</FieldMenu>
</div>
