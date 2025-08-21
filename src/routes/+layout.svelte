<script lang="ts">
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import Header from '$lib/components/Header.svelte';

	// let collapsed = $state(false);
	let { children } = $props();
</script>

<Sidebar.Provider>
	<ModeWatcher />
	<AppSidebar />
	<main class="w-full">
		<Header />
		{@render children?.()}
	</main>
</Sidebar.Provider>
<Toaster />
<style>

</style>