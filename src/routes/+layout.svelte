<script lang="ts">
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import '../app.css';
	import { Button } from '$lib/components/ui/button';

	// let collapsed = $state(false);
	let { children } = $props();
</script>

<Sidebar.Provider>
	<AppSidebar />
	<main>
		{@render children?.()}
		<Sidebar.Trigger/>
	</main>
</Sidebar.Provider>

<style>

</style>