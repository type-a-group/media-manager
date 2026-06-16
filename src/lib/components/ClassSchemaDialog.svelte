<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SchemaEditorBody from './schema-editor/SchemaEditorBody.svelte';
	import type { SchemaEditorAdapter } from './schema-editor/types.js';
	import {
		apiGetClass,
		apiAddClassField,
		apiUpdateClassField,
		apiDeleteClassField
	} from '$lib/api/files.js';

	/**
	 * Class schema editor dialog — a thin wrapper around the shared {@link SchemaEditorBody}, wired to
	 * the `/api/classes/[id]/schema` surface.
	 *
	 * @param classId - The class whose schema is edited.
	 * @param open - Bindable dialog open state.
	 * @param displayName - Class display name (dialog title).
	 * @param onchanged - Called after any schema mutation so callers can refresh counts/grids.
	 */
	let {
		classId,
		open = $bindable(false),
		displayName = '',
		onchanged
	}: {
		classId: string;
		open?: boolean;
		displayName?: string;
		onchanged?: () => void;
	} = $props();

	const adapter: SchemaEditorAdapter = {
		getSchema: async () => (await apiGetClass(classId)).schema,
		addField: (body) => apiAddClassField(classId, body),
		updateField: (body) => apiUpdateClassField(classId, body),
		deleteField: (fieldName, removeFromRecords) =>
			apiDeleteClassField(classId, fieldName, removeFromRecords)
	};
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col">
		<Dialog.Title>Schema — {displayName || classId}</Dialog.Title>
		<Dialog.Description>
			Add, edit, or remove fields for this class. A class with no fields is a valid pure tag.
		</Dialog.Description>

		{#if open}
			{#key classId}
				<SchemaEditorBody {adapter} recordNoun="record" {onchanged} />
			{/key}
		{/if}

		<Dialog.Footer>
			<Button type="button" onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
