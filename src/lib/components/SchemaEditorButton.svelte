<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Database } from 'lucide-svelte';
	import SchemaEditorBody from './schema-editor/SchemaEditorBody.svelte';
	import type { SchemaEditorAdapter } from './schema-editor/types.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import {
		apiGetSchemaForType,
		apiAddSchemaFieldForType,
		apiUpdateSchemaFieldForType,
		apiDeleteSchemaFieldForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { triggerImageListRefresh, triggerSchemaRefresh } from '$lib/stores/refreshTrigger.js';

	/**
	 * Media-type schema editor — a thin wrapper around the shared {@link SchemaEditorBody}, wired to
	 * the `/api/media-types/[typeId]/schema` surface. Reads the active type from
	 * `currentMediaTypeStore` and refreshes the image list + schema after each mutation.
	 */
	let isOpen = $state(false);
	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);

	/** Media-type key ordering: hide system keys, float the name field first. */
	function orderKeys(s: SchemaDefinition): string[] {
		return Object.keys(s)
			.filter((k) => !['file_name', 'last_modified', 'default'].includes(k))
			.sort((a, b) =>
				a === 'image_name' || a === 'name'
					? -1
					: b === 'image_name' || b === 'name'
						? 1
						: a.localeCompare(b)
			);
	}

	const adapter = $derived<SchemaEditorAdapter>({
		getSchema: () =>
			typeId ? apiGetSchemaForType(typeId) : Promise.reject(new Error('No media type')),
		addField: (body) =>
			typeId ? apiAddSchemaFieldForType(typeId, body) : Promise.reject(new Error('No media type')),
		updateField: (body) =>
			typeId
				? apiUpdateSchemaFieldForType(typeId, body)
				: Promise.reject(new Error('No media type')),
		deleteField: (fieldName, removeFromRecords) =>
			typeId
				? apiDeleteSchemaFieldForType(typeId, { fieldName, removeFromImages: removeFromRecords })
				: Promise.reject(new Error('No media type')),
		orderKeys
	});

	function afterChange() {
		triggerImageListRefresh();
		triggerSchemaRefresh();
	}
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="icon" title="Schema">
				<Database />
			</Button>
		{/snippet}
	</Dialog.Trigger>
	<Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col">
		<Dialog.Title>Schema</Dialog.Title>
		<Dialog.Description>Add, edit, or remove fields for this record type.</Dialog.Description>

		{#if isOpen && typeId}
			{#key typeId}
				<SchemaEditorBody {adapter} recordNoun="image" onchanged={afterChange} />
			{/key}
		{/if}

		<Dialog.Footer>
			<Button type="button" onclick={() => (isOpen = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
