<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import '../app.css';

	let collapsed = $state(false);
</script>

<main class:collapsed>
	<Sidebar bind:collapsed />
	<div class="content">
		<slot />
	</div>
	{#if collapsed}
		<button class="show-btn" on:click={() => (collapsed = !collapsed)} title="Show sidebar">
			&gt;
		</button>
	{/if}
</main>

<style>
	main {
		display: grid;
		grid-template-columns: 300px 1fr;
		height: 100vh;
		transition: grid-template-columns 0.3s ease-in-out;
		position: relative;
	}

	main.collapsed {
		grid-template-columns: 0px 1fr;
	}

	.content {
		overflow-y: auto;
	}

	.show-btn {
		position: absolute;
		top: 1rem;
		left: 1rem;
		background: #007bff;
		color: white;
		border: none;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		font-size: 1.5rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
	}
</style>
