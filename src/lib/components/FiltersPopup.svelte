<script lang="ts">
	import BasePopup from './BasePopup.svelte';
	
	/**
	 * Props for the FiltersPopup component
	 * @param show - Controls visibility of the popup
	 * @param searchQuery - Current search query value
	 * @param selectedField - Currently selected field for filtering
	 * @param filterForEmpty - Whether to filter for empty values
	 * @param schemaFields - Available schema fields for filtering
	 * @param onApply - Callback function when filters are applied
	 * @param onClose - Callback function when popup is closed
	 */
	let { 
		show = $bindable(),
		searchQuery = $bindable(),
		selectedField = $bindable(),
		filterForEmpty = $bindable(),
		schemaFields = [],
		onApply = () => {},
		onClose = () => {}
	} = $props();
</script>

<BasePopup bind:show {onClose} title="Advanced Filters">
	{#snippet children()}
		<div class="coming-soon-section">
			<div class="coming-soon-icon">🚧</div>
			<h3>Advanced Filters</h3>
			<p class="coming-soon-description">
				Advanced filtering capabilities are coming soon! This will include features like:
			</p>
			<ul class="feature-list">
				<li>🏷️ Tag-based filtering</li>
				<li>📅 Date range filtering</li>
				<li>📏 File size and dimension filters</li>
				<li>🔄 Advanced sorting options</li>
				<li>📊 Metadata-based searches</li>
			</ul>
			<p class="current-features">
				For now, use the search bar and filters in the main sidebar for basic filtering needs.
			</p>
		</div>
	{/snippet}
	
	{#snippet footer()}
		<button class="btn btn-primary" onclick={() => { onClose(); show = false; }}>Got it!</button>
	{/snippet}
</BasePopup>

<style>
	.coming-soon-section {
		text-align: center;
		padding: 2rem 1rem;
	}

	.coming-soon-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
		animation: bounce 2s ease-in-out infinite;
	}

	@keyframes bounce {
		0%, 20%, 50%, 80%, 100% {
			transform: translateY(0);
		}
		40% {
			transform: translateY(-10px);
		}
		60% {
			transform: translateY(-5px);
		}
	}

	.coming-soon-section h3 {
		margin: 0 0 1rem 0;
		font-size: 1.5rem;
		color: #333;
		font-weight: 600;
	}

	.coming-soon-description {
		color: #6c757d;
		font-size: 1rem;
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.feature-list {
		list-style: none;
		padding: 0;
		margin: 1.5rem 0;
		text-align: left;
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	.feature-list li {
		padding: 0.75rem;
		margin-bottom: 0.5rem;
		background: #f8f9fa;
		border-radius: 8px;
		color: #495057;
		font-size: 0.95rem;
		border-left: 4px solid #007bff;
		transition: all 0.2s ease;
	}

	.feature-list li:hover {
		background: #e9ecef;
		transform: translateX(5px);
	}

	.current-features {
		color: #6c757d;
		font-size: 0.9rem;
		margin-top: 1.5rem;
		padding: 1rem;
		background: #f8f9fa;
		border-radius: 8px;
		border: 1px solid #e9ecef;
		line-height: 1.4;
	}

	.btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.2s ease;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.btn-primary {
		background: #007bff;
		color: white;
	}

	.btn-primary:hover {
		background: #0056b3;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.coming-soon-section {
			padding: 1.5rem 0.75rem;
		}
		
		.feature-list {
			max-width: 100%;
		}
	}
</style> 