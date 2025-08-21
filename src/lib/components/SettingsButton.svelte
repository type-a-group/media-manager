<script lang="ts">
	import { settingsStore, type AppSettings } from '$lib/stores/settings';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { SettingsIcon } from 'lucide-svelte';
	
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
	
	let settings = $state<AppSettings>({ autoAdvanceToNextUnlinked: false });
	let resetToDefaultsOpen = $state(false);
	let isOpen = $state(false);
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
		settingsStore.resetToDefaults();
		resetToDefaultsOpen = false;
	}
	
	/**
	 * Handle closing the popup
	 */
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Trigger>
		<Button variant="outline" size="icon" title="Settings">
			<SettingsIcon />
		</Button>
	</Dialog.Trigger>
	<Dialog.Content>
		<Dialog.Title>Settings</Dialog.Title>
		<Dialog.Description>
			Manage your settings here.
		</Dialog.Description>
		<div class="flex flex-col gap-2">
			<h3 class="text-lg font-bold">Navigation</h3>
			<div class="flex flex-row gap-2 items-center">
				<Checkbox 
					id="auto-advance"
					checked={settings.autoAdvanceToNextUnlinked}
					onchange={(e) => handleAutoAdvanceChange((e.target as HTMLInputElement).checked)}
				/>
				<Label for="auto-advance">Auto-advance to next unlinked image</Label>
			</div>
		</div>
		<Separator />
		<Dialog.Footer>
			<AlertDialog.Root bind:open={resetToDefaultsOpen}>
				<AlertDialog.Trigger>
					<Button variant="outline" class="btn btn-secondary">
						Reset to Defaults
					</Button>
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Title>Reset to Defaults</AlertDialog.Title>
					<AlertDialog.Description>
						Are you sure you want to reset all settings to their default values?
					</AlertDialog.Description>
					<div class="flex justify-end">
						<form onsubmit={handleResetToDefaults} class="flex gap-2">
							<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
							<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
						</form>
					</div>
				</AlertDialog.Content>
			</AlertDialog.Root>
			<Button variant="default" class="btn btn-primary" type="submit" onclick={() => isOpen = false}>
				Done
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
</style> 