<script lang="ts">
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import Header from '$lib/components/Header.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { TOOLTIP_DELAY_MS } from '$lib/utils.js';

	// let collapsed = $state(false);
	let { children } = $props();
</script>

<Sidebar.Provider>
	<ModeWatcher />
	<AppSidebar />
	<main class="w-full">
		<Header />
		<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
			{@render children?.()}
		</Tooltip.Provider>
	</main>
</Sidebar.Provider>
<Toaster />
<style>

</style>