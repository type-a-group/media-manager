<script lang="ts">
	/**
	 * BasePopup - A reusable popup/modal component
	 * 
	 * @param show - Controls visibility of the popup
	 * @param title - Title text for the popup header
	 * @param maxWidth - Maximum width of the popup content (default: '600px')
	 * @param onClose - Callback function when popup is closed
	 * @param children - Snippet for main popup content
	 * @param footer - Optional snippet for footer content
	 * 
	 * Features:
	 * - Modal overlay with backdrop blur
	 * - Click outside to close
	 * - Escape key to close  
	 * - Accessible with proper ARIA attributes
	 * - Flexible content via snippets
	 * - Responsive design
	 * 
	 * #NOTE: Future improvements:
	 * - Add support for different sizes (small, medium, large)
	 * - Add animation transitions
	 * - Add focus management for better accessibility
	 */
	let { 
		show = $bindable(),
		title = 'Popup',
		maxWidth = '600px',
		onClose = () => {},
		children,
		footer = undefined
	} = $props();

	let popupElement: HTMLDivElement | undefined = $state();
	let overlayElement: HTMLDivElement | undefined = $state();

	/**
	 * Focus the popup when it opens to ensure keyboard events work
	 */
	$effect(() => {
		if (show && overlayElement) {
			overlayElement.focus();
		}
	});

	/**
	 * Handles clicking outside the popup to close it
	 */
	function handleClickOutside(event: MouseEvent) {
		if (popupElement && !popupElement.contains(event.target as Node)) {
			handleClose();
		}
	}

	/**
	 * Handles escape key press to close popup
	 */
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	/**
	 * Centralized close handler
	 */
	function handleClose() {
		onClose();
		show = false;
	}
</script>

{#if show}
	<div 
		bind:this={overlayElement}
		class="popup-overlay" 
		onclick={handleClickOutside} 
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="popup-title"
		tabindex="-1"
	>
		<div 
			bind:this={popupElement} 
			class="popup-content" 
			style="max-width: {maxWidth}"
		>
			<header class="popup-header">
				<h2 id="popup-title">{title}</h2>
				<button 
					class="close-btn" 
					onclick={handleClose} 
					aria-label="Close popup"
				>
					×
				</button>
			</header>
			
			<div class="popup-body">
				{@render children()}
			</div>
			
			{#if footer}
				<footer class="popup-footer">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.popup-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		backdrop-filter: blur(2px);
	}

	.popup-content {
		background: white;
		border-radius: 12px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
		width: 90%;
		max-height: 80vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.popup-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem;
		border-bottom: 1px solid #eee;
		background: #f8f9fa;
	}

	.popup-header h2 {
		margin: 0;
		font-size: 1.5rem;
		color: #333;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 2rem;
		cursor: pointer;
		color: #666;
		padding: 0;
		line-height: 1;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		background: #f0f0f0;
		color: #333;
	}

	.popup-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex-grow: 1;
	}

	.popup-footer {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
		padding: 1.5rem;
		border-top: 1px solid #eee;
		background: #f8f9fa;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.popup-content {
			width: 95%;
			max-height: 90vh;
		}
	}

	/* Custom scrollbar styling */
	.popup-body::-webkit-scrollbar {
		width: 8px;
	}
	
	.popup-body::-webkit-scrollbar-track {
		background: #f1f1f1;
		border-radius: 4px;
	}
	
	.popup-body::-webkit-scrollbar-thumb {
		background: #c1c1c1;
		border-radius: 4px;
	}
	
	.popup-body::-webkit-scrollbar-thumb:hover {
		background: #a8a8a8;
	}
</style> 