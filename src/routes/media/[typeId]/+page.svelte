<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import JsonEditorPane from '$lib/components/JsonEditorPane.svelte';
	import GlobalsEditorPane from '$lib/components/GlobalsEditorPane.svelte';
	import { apiGetMediaType } from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { useSelection } from '$lib/state/selection.svelte';

	const selection = useSelection();

	let typeId = $derived($page.params.typeId);
	let typeInfo = $state<{
		id: string;
		displayName: string;
		kind: 'images' | 'json' | 'generic' | 'blob_store';
	} | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(() => {
		currentMediaTypeStore.set(null);
		return () => {
			currentMediaTypeStore.set(null);
		};
	});

	$effect(() => {
		const id = typeId;
		if (!id) return;
		loading = true;
		error = null;
		apiGetMediaType(id)
			.then(async (info) => {
				typeInfo = {
					id: info.id,
					displayName: info.displayName ?? info.id,
					kind: info.kind
				};
				currentMediaTypeStore.set({
					typeId: info.id,
					kind: info.kind,
					displayName: info.displayName
				});
				selection.selectImage(null);
				await selection.setGridViewActive(true);
			})
			.catch((e) => {
				error = (e as Error)?.message ?? 'Failed to load media type';
				currentMediaTypeStore.set(null);
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

{#if loading}
	<div class="flex min-h-[50vh] items-center justify-center p-8">
		<p class="text-muted-foreground">Loading…</p>
	</div>
{:else if error}
	<div class="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8">
		<p class="text-destructive">{error}</p>
		<a href="/" class="text-primary underline">Back to overview</a>
	</div>
{:else if typeInfo?.id === 'globals'}
	<GlobalsEditorPane />
{:else if typeInfo?.kind === 'json'}
	<JsonEditorPane />
{:else}
	<div class="flex min-h-[50vh] items-center justify-center p-8">
		<p class="text-muted-foreground">Unknown media type</p>
	</div>
{/if}
