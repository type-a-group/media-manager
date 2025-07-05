<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { filteredImageList } from '$lib/stores/imageList';	

	let imageLists = $state<{
		inBoth: string[];
		inAssetsOnly: string[];
	}>({
		inBoth: [],
		inAssetsOnly: []
	});
	let view = $state<'linked' | 'unlinked'>('linked');
	let loading = $state(true);

	let { collapsed = $bindable() } = $props();

	let searchQuery = $state('');
	let selectedField = $state('');
	let filterForEmpty = $state(false);
	let schemaFields = $state<string[]>([]);

	// This will hold the filenames actually displayed in the sidebar
	let displayedFilenames = $state<string[]>([]);

	async function fetchSchema() {
		const response = await fetch('/api/schema');
		if (response.ok) {
			const schema = await response.json();
			schemaFields = Object.keys(schema);
			if (schemaFields.length > 0) {
				selectedField = schemaFields[0];
			}
		}
	}

	async function fetchImageLists() {
		loading = true;
		const params = new URLSearchParams();

		if (filterForEmpty) {
			params.append('empty', 'true');
			if (selectedField) {
				params.append('field', selectedField);
			}
		} else if (searchQuery && selectedField) {
			params.append('query', searchQuery);
			params.append('field', selectedField);
		}

		const response = await fetch(`/api/images/compare?${params.toString()}`);
		if (response.ok) {
			const data = await response.json();
			imageLists = {
				inBoth: data.inBoth || [],
				inAssetsOnly: data.inAssetsOnly || []
			};
			updateDisplayedFilenames();
		}
		loading = false;
	}

	function updateDisplayedFilenames() {
		// Always reflect the current view and any search/filter
		if (view === 'linked') {
			displayedFilenames = imageLists.inBoth;
		} else {
			displayedFilenames = imageLists.inAssetsOnly;
		}
		// Set the store to match the displayed list
		filteredImageList.set(displayedFilenames);
	}

	// When view changes, update displayedFilenames and store
	$effect(() => {
		updateDisplayedFilenames();
	});

	onMount(fetchSchema);

	$effect(() => {
		// This will re-run whenever searchQuery, selectedField, or filterForEmpty changes
		fetchImageLists();
	});
</script>

<div class="sidebar" class:collapsed>
	<div class="controls">
		<button class:active={view === 'linked'} on:click={() => (view = 'linked')}>
			Linked
		</button>
		<button class:active={view === 'unlinked'} on:click={() => (view = 'unlinked')}>
			Unlinked
		</button>
		<button class="sync-btn" on:click={fetchImageLists} title="Refresh lists">
			🔄
		</button>
		<button class="collapse-btn" on:click={() => (collapsed = !collapsed)} title="Toggle sidebar">
			&lt;
		</button>
	</div>
	<fieldset class="filter-controls">
		<legend>Filters</legend>
		<div class="form-group">
			<label for="search-input">Search</label>
			<input
				id="search-input"
				type="text"
				placeholder="Search..."
				bind:value={searchQuery}
				disabled={filterForEmpty}
			/>
		</div>
		<div class="form-group">
			<label for="field-select">Field</label>
			<select id="field-select" bind:value={selectedField}>
				{#each schemaFields as field}
					<option value={field}>{field}</option>
				{/each}
			</select>
		</div>
		<div class="form-group-checkbox">
			<label for="empty-checkbox">
				<input id="empty-checkbox" type="checkbox" bind:checked={filterForEmpty} />
				Filter for empty
			</label>
		</div>
	</fieldset>
	<ul class="file-list">
		{#if loading}
			<li>Loading...</li>
		{:else}
			{#if displayedFilenames.length > 0}
				{#each displayedFilenames as filename (filename)}
					<a
						href="/edit/{filename}?view={view}"
						class:selected={$page.params.filename === filename}
					>
						<li>{filename}</li>
					</a>
				{/each}
			{:else}
				<li>No {view} images found.</li>
			{/if}
		{/if}
	</ul>
</div>

<style>
	.sidebar {
		border-right: 1px solid #ccc;
		padding: 1rem;
		height: 100vh;
		background: #f7f7f7;
		display: flex;
		flex-direction: column;
		transition: width 0.3s ease-in-out;
		overflow: hidden;
	}

	.sidebar.collapsed {
		padding: 0;
	}

	.sidebar.collapsed > * {
		visibility: hidden;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		align-items: center;
	}
	button {
		padding: 0.5rem 1rem;
		border: 1px solid #ccc;
		background: white;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s ease-in-out;
	}
	button:hover {
		background: #eee;
	}
	button.active {
		background: #007bff;
		color: white;
		border-color: #007bff;
	}
	button.active:hover {
		background: #0056b3;
	}
	.collapse-btn {
		margin-left: auto;
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.sync-btn {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.file-list {
		list-style: none;
		padding: 0;
		margin: 0;
		overflow-y: auto;
		flex-grow: 1;
	}
	.file-list a {
		text-decoration: none;
		color: inherit;
		display: block;
	}
	.file-list li {
		padding: 0.5rem;
		cursor: pointer;
		border-radius: 4px;
	}
	.file-list li:hover {
		background: #eee;
	}
	.file-list a.selected li {
		background: #cce5ff;
	}
	.filter-controls {
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0.5rem;
		margin-bottom: 1rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		align-items: center;
	}
	.filter-controls legend {
		padding: 0 0.5rem;
		font-size: 0.9rem;
		color: #555;
	}
	.form-group {
		display: contents;
	}
	.form-group-checkbox {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.filter-controls label {
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.filter-controls input[type='text'],
	.filter-controls select {
		width: 100%;
		padding: 0.25rem;
	}
	.form-group-checkbox label {
		cursor: pointer;
		display: flex;
		align-items: center;
	}
</style>