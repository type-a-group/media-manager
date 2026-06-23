<script lang="ts">
	import { onMount } from 'svelte';
	import EntityRail from '$lib/components/rail/EntityRail.svelte';
	import GlobalsEditorPane from '$lib/components/GlobalsEditorPane.svelte';
	import { settingsStore } from '$lib/stores/settings.js';

	/**
	 * The **Globals** sub-app — a peer of Files and Records (no longer nested under the Records hub at
	 * `/media?type=globals`). It hosts the bespoke {@link GlobalsEditorPane} (the reserved `json`
	 * singleton's free-form editor) inside the shared {@link EntityRail} shell so the sub-app switcher
	 * and Home/Settings footer stay consistent across all three sub-apps. Globals has no entity list, so
	 * the rail body is just a short descriptor; the editor owns its own header, search, and autosave.
	 */
	let railCollapsed = $state(false);

	function toggleRail() {
		railCollapsed = !railCollapsed;
		settingsStore.updateSetting('railCollapsed', railCollapsed);
	}

	onMount(() => {
		settingsStore.fetchSettings();
		const unsub = settingsStore.subscribe((s) => {
			railCollapsed = s.railCollapsed;
		});
		return unsub;
	});
</script>

<div class="flex h-screen w-full overflow-hidden">
	<EntityRail current="globals" collapsed={railCollapsed} onToggleCollapse={toggleRail}>
		{#snippet body()}
			<p class="px-2 py-1 text-xs text-muted-foreground">
				One app-wide settings record, grouped into sections.
			</p>
		{/snippet}
	</EntityRail>

	<div class="min-w-0 flex-1">
		<GlobalsEditorPane />
	</div>
</div>
