<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import {
		ChevronRight,
		GripVertical,
		MoreVertical,
		Pencil,
		ArrowUp,
		ArrowDown,
		Trash2,
		Plus
	} from 'lucide-svelte';
	import FieldMenu from './FieldMenu.svelte';
	import type { Snippet } from 'svelte';
	import type { GlobalsSection } from '$lib/core/globalsLayout.js';

	type ValueKind = 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' | 'file';
	type ItemType = 'string' | 'number' | 'url';
	type FieldMeta = { options?: string[]; multiselect?: boolean; itemType?: ItemType };
	type SectionOption = { id: string; name: string };

	/**
	 * One collapsible section in the Globals editor: a header (drag grip + caret + name + count + a `⋮`
	 * menu for rename / move / delete) over a body of field rows. The parent supplies the rows through
	 * the `body` snippet so each row can `bind:value` directly into the host's `formValues`; this
	 * component owns only the section chrome and emits structural intents upward.
	 */
	let {
		section,
		count,
		isFirst,
		isLast,
		sections,
		body,
		onToggleCollapse,
		onRename,
		onMoveUp,
		onMoveDown,
		onDelete,
		onAddField,
		onSectionDragStart,
		onSectionDragOver,
		onSectionDrop,
		onSectionDragEnd,
		onBodyDragOver,
		onBodyDrop,
		dropIndicator = false
	}: {
		section: GlobalsSection;
		count: number;
		isFirst: boolean;
		isLast: boolean;
		sections: SectionOption[];
		body: Snippet;
		onToggleCollapse: (collapsed: boolean) => void;
		onRename: (name: string) => void;
		onMoveUp: () => void;
		onMoveDown: () => void;
		onDelete: () => void;
		onAddField: (field: {
			key: string;
			kind: ValueKind;
			meta: FieldMeta;
			sectionId: string;
		}) => boolean;
		onSectionDragStart: () => void;
		onSectionDragOver: (e: DragEvent) => void;
		onSectionDrop: () => void;
		onSectionDragEnd: () => void;
		onBodyDragOver?: (e: DragEvent) => void;
		onBodyDrop?: () => void;
		dropIndicator?: boolean;
	} = $props();

	let renaming = $state(false);
	let nameInput = $state('');
	let dragging = $state(false);

	function startRename() {
		nameInput = section.name;
		renaming = true;
	}
	function commitRename() {
		const next = nameInput.trim();
		renaming = false;
		if (next && next !== section.name) onRename(next);
	}
</script>

<div
	class="group/sec {dropIndicator ? 'border-t-2 border-t-primary' : ''} {dragging
		? 'opacity-50'
		: ''}"
	role="group"
	ondragover={(e) => {
		// Section-level reorder when the drag is over the header band; row/body drops handle the rest.
		onSectionDragOver(e);
	}}
	ondrop={() => onSectionDrop()}
>
	<Collapsible.Root open={!section.collapsed} onOpenChange={(o) => onToggleCollapse(!o)}>
		<!-- Flat header: a small uppercase label rule, not a card. Click the label/caret to fold. -->
		<div class="flex items-center gap-1.5 border-b px-1 pb-1.5 pt-3">
			<!-- Section drag grip (reveals on hover so the flat header stays clean) -->
			<button
				type="button"
				class="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover/sec:opacity-100 active:cursor-grabbing"
				draggable="true"
				aria-label="Drag to reorder section"
				ondragstart={() => {
					dragging = true;
					onSectionDragStart();
				}}
				ondragend={() => {
					dragging = false;
					onSectionDragEnd();
				}}
			>
				<GripVertical class="size-3.5" />
			</button>

			<!-- Caret toggle -->
			<Collapsible.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="flex items-center text-muted-foreground/70 transition-transform data-[state=open]:rotate-90"
						aria-label="Toggle section"
					>
						<ChevronRight class="size-3.5" />
					</button>
				{/snippet}
			</Collapsible.Trigger>

			<!-- Name / inline rename. Click toggles; double-click renames (also in ⋮). -->
			{#if renaming}
				<Input
					class="h-6 w-48 text-xs"
					bind:value={nameInput}
					onblur={commitRename}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							commitRename();
						} else if (e.key === 'Escape') {
							renaming = false;
						}
					}}
				/>
			{:else}
				<button
					type="button"
					class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
					onclick={() => onToggleCollapse(!section.collapsed)}
					ondblclick={startRename}
				>
					{section.name}
				</button>
			{/if}

			<span class="text-[11px] text-muted-foreground/60">{count}</span>

			<div class="ml-auto opacity-0 transition-opacity group-hover/sec:opacity-100">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="size-7 text-muted-foreground"
								aria-label="Section options"
							>
								<MoreVertical class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item onclick={startRename}>
							<Pencil class="mr-2 size-4" /> Rename
						</DropdownMenu.Item>
						<DropdownMenu.Item disabled={isFirst} onclick={onMoveUp}>
							<ArrowUp class="mr-2 size-4" /> Move up
						</DropdownMenu.Item>
						<DropdownMenu.Item disabled={isLast} onclick={onMoveDown}>
							<ArrowDown class="mr-2 size-4" /> Move down
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							class="text-destructive data-[highlighted]:text-destructive"
							onclick={onDelete}
						>
							<Trash2 class="mr-2 size-4" /> Delete section
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>

		<Collapsible.Content>
			<div
				class="py-1 pl-1"
				role="list"
				ondragover={(e) => {
					e.preventDefault();
					onBodyDragOver?.(e);
				}}
				ondrop={(e) => {
					e.preventDefault();
					onBodyDrop?.();
				}}
			>
				{@render body()}
				{#if count === 0}
					<p class="px-1 py-3 text-sm text-muted-foreground">No fields yet.</p>
				{/if}
				<div class="pt-2">
					<FieldMenu mode="add" defaultSectionId={section.id} {sections} onAdd={onAddField}>
						{#snippet trigger()}
							<Button variant="ghost" size="sm" class="text-muted-foreground">
								<Plus class="mr-1 size-4" /> Add field
							</Button>
						{/snippet}
					</FieldMenu>
				</div>
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
</div>
