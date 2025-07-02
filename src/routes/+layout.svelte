<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import '../app.css';
</script>

<main>
	<Sidebar />
	<div class="content">
		<slot />
	</div>
</main>

<style>
	main {
		display: grid;
		grid-template-columns: 300px 1fr;
		height: 100vh;
	}

	.content {
		overflow-y: auto;
	}
</style>
