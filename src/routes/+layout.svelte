<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { TOOLTIP_DELAY_MS } from '$lib/utils.js';
	import { setSelectionContext } from '$lib/state/selection.svelte';
	import { settingsStore } from '$lib/stores/settings.js';
	import SidebarTriggerOverlay from '$lib/components/SidebarTriggerOverlay.svelte';

	let { children } = $props();

	// Initialize shared, in-memory selection state for the whole app.
	const selection = setSelectionContext();

	// The dashboard (/) and the file hub (/files) bring their own chrome; only the record-type
	// editor at /media/[typeId] uses the shared AppSidebar shell.
	const isEditor = $derived($page.url.pathname.startsWith('/media/'));

	onMount(async () => {
		await settingsStore.fetchSettings();
		const s = settingsStore.getCurrentSettings();
		selection.setGridSize(s.gridSize ?? 'medium');
	});
</script>

<!-- Mounted at the top level so the theme (.dark class on <html>) applies on every
     route, not just the /media editor. -->
<ModeWatcher defaultMode="system" />
{#if isEditor}
	<Sidebar.Provider>
		<AppSidebar />
		<main class="w-full relative">
			<SidebarTriggerOverlay />
			<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
				{@render children?.()}
			</Tooltip.Provider>
		</main>
	</Sidebar.Provider>
{:else}
	<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
		{@render children?.()}
	</Tooltip.Provider>
{/if}
<Toaster />

<style>
</style>
