<script lang="ts">
	import BasePopup from './BasePopup.svelte';
	import { settingsStore, type AppSettings } from '$lib/stores/settings';
	
	/**
	 * SettingsPopup component for managing application preferences
	 * 
	 * @param isOpen - Controls whether the popup is visible
	 * @param onClose - Callback function to close the popup
	 * 
	 * Features:
	 * - Auto-advance to next unlinked image setting
	 * - Persistent settings stored in localStorage
	 * - Reset to defaults functionality
	 * - Responsive design with consistent styling
	 * 
	 * #NOTE: Future settings to add:
	 * - Default view (linked/unlinked) preference
	 * - Theme preferences (dark/light mode)
	 * - Image preview size settings
	 * - Auto-refresh interval for image lists
	 * - Default sort order preferences
	 */
	
	let { isOpen = $bindable(), onClose = () => {} } = $props<{
		isOpen: boolean;
		onClose: () => void;
	}>();
	
	let settings = $state<AppSettings>({ autoAdvanceToNextUnlinked: false });
	
	// Subscribe to settings store
	$effect(() => {
		const unsubscribe = settingsStore.subscribe(currentSettings => {
			settings = currentSettings;
		});
		
		return () => {
			unsubscribe();
		};
	});
	
	/**
	 * Handle changing the auto-advance setting
	 * @param enabled - Whether auto-advance should be enabled
	 */
	function handleAutoAdvanceChange(enabled: boolean) {
		settingsStore.updateSetting('autoAdvanceToNextUnlinked', enabled);
	}
	
	/**
	 * Reset all settings to their default values
	 */
	function handleResetToDefaults() {
		if (confirm('Are you sure you want to reset all settings to their default values?')) {
			settingsStore.resetToDefaults();
		}
	}
	
	/**
	 * Handle closing the popup
	 */
	function handleClose() {
		onClose();
		isOpen = false;
	}
</script>

<BasePopup bind:show={isOpen} {onClose} title="Settings">
	{#snippet children()}
		<div class="settings-section">
			<h3>Navigation</h3>
			<div class="setting-item">
				<label class="setting-label">
					<div class="setting-info">
						<span class="setting-name">Auto-advance to next unlinked image</span>
						<span class="setting-description">
							When saving a previously unlinked image, automatically navigate to the next unlinked image in the current list.
						</span>
					</div>
					<input 
						type="checkbox" 
						class="setting-checkbox"
						checked={settings.autoAdvanceToNextUnlinked}
						onchange={(e) => handleAutoAdvanceChange(e.target.checked)}
					/>
				</label>
			</div>
		</div>
		
		<div class="settings-section">
			<h3>Future Settings</h3>
			<div class="coming-soon-info">
				<p>🚧 More settings coming soon:</p>
				<ul class="future-settings-list">
					<li>Default view preference (linked/unlinked)</li>
					<li>Theme preferences (dark/light mode)</li>
					<li>Image preview size settings</li>
					<li>Auto-refresh interval</li>
					<li>Default sort order preferences</li>
				</ul>
			</div>
		</div>
	{/snippet}
	
	{#snippet footer()}
		<div class="settings-footer">
			<button class="btn btn-secondary" onclick={handleResetToDefaults}>
				🔄 Reset to Defaults
			</button>
			<button class="btn btn-primary" onclick={handleClose}>
				✅ Done
			</button>
		</div>
	{/snippet}
</BasePopup>

<style>
	.settings-section {
		margin-bottom: 2rem;
	}
	
	.settings-section:last-child {
		margin-bottom: 0;
	}
	
	.settings-section h3 {
		margin: 0 0 1rem 0;
		font-size: 1.2rem;
		color: #333;
		font-weight: 600;
		border-bottom: 2px solid #e9ecef;
		padding-bottom: 0.5rem;
	}
	
	.setting-item {
		background: #f8f9fa;
		border: 1px solid #e9ecef;
		border-radius: 8px;
		padding: 1rem;
		transition: all 0.2s ease;
	}
	
	.setting-item:hover {
		border-color: #007bff;
		box-shadow: 0 2px 8px rgba(0, 123, 255, 0.1);
	}
	
	.setting-label {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		cursor: pointer;
		margin: 0;
	}
	
	.setting-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	
	.setting-name {
		font-weight: 600;
		color: #333;
		font-size: 1rem;
	}
	
	.setting-description {
		color: #6c757d;
		font-size: 0.9rem;
		line-height: 1.4;
	}
	
	.setting-checkbox {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid #e0e0e0;
		border-radius: 4px;
		background: white;
		cursor: pointer;
		appearance: none;
		position: relative;
		transition: all 0.2s ease;
		margin: 0;
		flex-shrink: 0;
	}
	
	.setting-checkbox:checked {
		background: #007bff;
		border-color: #007bff;
	}
	
	.setting-checkbox:checked::after {
		content: '✓';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		font-size: 1rem;
		font-weight: bold;
	}
	
	.setting-checkbox:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
	}
	
	.setting-checkbox:hover {
		border-color: #007bff;
	}
	
	.coming-soon-info {
		background: #f8f9fa;
		border: 1px solid #e9ecef;
		border-radius: 8px;
		padding: 1rem;
		color: #6c757d;
	}
	
	.coming-soon-info p {
		margin: 0 0 0.75rem 0;
		font-weight: 600;
	}
	
	.future-settings-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	
	.future-settings-list li {
		padding: 0.25rem 0;
		padding-left: 1rem;
		position: relative;
		color: #6c757d;
		font-size: 0.9rem;
	}
	
	.future-settings-list li::before {
		content: '•';
		position: absolute;
		left: 0;
		color: #007bff;
		font-weight: bold;
	}
	
	.settings-footer {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		align-items: center;
	}
	
	.btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.9rem;
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
	
	.btn-secondary {
		background: #6c757d;
		color: white;
	}
	
	.btn-secondary:hover {
		background: #5a6268;
	}
	
	/* Responsive adjustments */
	@media (max-width: 768px) {
		.setting-label {
			flex-direction: column;
			gap: 0.75rem;
		}
		
		.setting-checkbox {
			align-self: flex-start;
		}
		
		.settings-footer {
			flex-direction: column;
			gap: 0.5rem;
		}
		
		.btn {
			width: 100%;
		}
	}
</style> 