<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import BulkSetFieldDialog from '$lib/components/BulkSetFieldDialog.svelte';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { apiBulkUpdatePropertiesForType, apiBulkDeleteForType } from '$lib/api/client.js';

	/**
	 * Bulk actions for a multi-selected set of `json` records — "Set field…" (apply one value across
	 * all selected, via the shared {@link BulkSetFieldDialog}) and "Delete". Renders the inline header
	 * controls plus the two dialogs; the host places it in the grid's `bulkBar` snippet.
	 *
	 * @param typeId - The `json` media type id.
	 * @param schema - The type's schema (drives the field/value widgets).
	 * @param selectedIds - The currently multi-selected record ids.
	 * @param onchanged - Called after a successful bulk update/delete (host clears selection + refreshes).
	 */
	let {
		typeId,
		schema,
		selectedIds,
		onchanged
	}: {
		typeId: string;
		schema: SchemaDefinition | null;
		selectedIds: string[];
		onchanged: () => void;
	} = $props();

	let setFieldDialogOpen = $state(false);
	let deleteConfirmOpen = $state(false);

	/** Apply one field value to every selected record (replace semantics). Throws on failure so the dialog stays open. */
	async function applySetField(key: string, value: unknown) {
		await apiBulkUpdatePropertiesForType(typeId, selectedIds, { [key]: value });
		toast.success(`Updated ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}`);
		onchanged();
	}

	async function handleDeleteRecords() {
		if (selectedIds.length === 0) return;
		try {
			await apiBulkDeleteForType(typeId, selectedIds);
			toast.success(`Deleted ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}`);
			deleteConfirmOpen = false;
			onchanged();
		} catch (e) {
			console.error(e);
			toast.error('Delete failed');
		}
	}
</script>

<span class="text-sm text-muted-foreground">{selectedIds.length} selected</span>
<Button
	variant="outline"
	size="sm"
	disabled={selectedIds.length === 0}
	onclick={() => (setFieldDialogOpen = true)}>Set field…</Button
>
<Button
	variant="destructive"
	size="sm"
	disabled={selectedIds.length === 0}
	onclick={() => (deleteConfirmOpen = true)}
>
	<Trash2 class="mr-1 size-4" /> Delete
</Button>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete records</AlertDialog.Title>
		<AlertDialog.Description>
			Delete {selectedIds.length} record{selectedIds.length === 1 ? '' : 's'}? This cannot be
			undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" onclick={handleDeleteRecords}>Delete</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<BulkSetFieldDialog
	bind:open={setFieldDialogOpen}
	{schema}
	selectedCount={selectedIds.length}
	apply={applySetField}
/>
