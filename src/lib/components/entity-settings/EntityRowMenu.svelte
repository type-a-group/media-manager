<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { MoreVertical } from 'lucide-svelte';

	/**
	 * The shared per-entity **⋮ menu** (Menu "Style 1"): a single `Settings…` entry plus a separated
	 * `Delete {noun}`. Used identically on Files class rows, Records type rows, and the content-column
	 * header (so settings stay reachable when the rail is collapsed). Both destinations are injected so
	 * the menu is side-agnostic.
	 *
	 * @param noun - Entity label ("class" | "record type") for the delete item.
	 * @param onSettings - Open the unified {@link EntitySettingsDialog}.
	 * @param onDelete - Open the host's delete confirmation.
	 * @param title - Trigger tooltip (default "Manage {noun}").
	 * @param triggerClass - Extra classes for the ⋮ trigger button (sizing per host).
	 */
	let {
		noun,
		onSettings,
		onDelete,
		title,
		triggerClass = 'size-6'
	}: {
		noun: string;
		onSettings: () => void;
		onDelete: () => void;
		title?: string;
		triggerClass?: string;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class={triggerClass}
				title={title ?? `Manage ${noun}`}
			>
				<MoreVertical class="size-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Item onSelect={onSettings}>Settings…</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item class="text-destructive" onSelect={onDelete}>
			Delete {noun}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
