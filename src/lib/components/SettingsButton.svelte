<script lang="ts">
	import { settingsStore, type AppSettings } from '$lib/stores/settings';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { apiGetSettingsForType, apiUpdateSettingsForType } from '$lib/api/client.js';
	import { setSelectionContext } from '$lib/state/selection.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select/index.js';
	import { SettingsIcon } from 'lucide-svelte';
	import AppearanceSettings from '$lib/components/AppearanceSettings.svelte';
	import { isBrowseFirstFileKind } from '$lib/core/mediaKinds.js';

	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const kind = $derived($currentMediaTypeStore?.kind ?? null);
	const selection = setSelectionContext();
	const browseFirst = $derived(isBrowseFirstFileKind(kind));
	/** Label for "item" in navigation settings (record vs file vs image). */
	const itemLabel = $derived(kind === 'json' ? 'record' : browseFirst ? 'file' : 'image');

	let settings = $state<AppSettings>({
		autoAdvanceToNextUnlinked: false,
		autoSaveOnAdvance: false,
		gridSize: 'medium'
	});
	let resetToDefaultsOpen = $state(false);
	let isOpen = $state(false);
	/** When typeId is set, which tab is active: project-specific or global. */
	let activeTab = $state<'project' | 'global'>('project');
	/** Local value for Grid size dropdown; synced with settings. */
	let gridSizeSetting = $state<'small' | 'medium' | 'large'>('medium');

	$effect(() => {
		gridSizeSetting = settings.gridSize;
	});
	$effect(() => {
		if (settings.gridSize !== gridSizeSetting && !typeId) {
			settingsStore.updateSetting('gridSize', gridSizeSetting);
		}
	});

	/** Re-fetch settings when dialog opens (in case changed externally). */
	$effect(() => {
		if (isOpen) {
			if (typeId) {
				apiGetSettingsForType(typeId)
					.then((s) => {
						settings = {
							autoAdvanceToNextUnlinked: s.autoAdvanceToNextUnlinked ?? false,
							autoSaveOnAdvance: s.autoSaveOnAdvance ?? false,
							gridSize: (s.gridSize as 'small' | 'medium' | 'large') ?? 'medium'
						};
					})
					.catch(() => {});
			} else {
				settingsStore.fetchSettings();
			}
		}
	});

	$effect(() => {
		if (typeId) return;
		const unsubscribe = settingsStore.subscribe((currentSettings) => {
			settings = currentSettings;
		});
		return () => unsubscribe();
	});

	function handleAutoAdvanceChange(enabled: boolean) {
		if (typeId) {
			apiUpdateSettingsForType(typeId, { autoAdvanceToNextUnlinked: enabled })
				.then(() => {
					settings = { ...settings, autoAdvanceToNextUnlinked: enabled };
				})
				.catch(() => {});
		} else {
			settingsStore.updateSetting('autoAdvanceToNextUnlinked', enabled);
		}
	}

	function handleAutoSaveOnAdvanceChange(enabled: boolean) {
		if (typeId) {
			apiUpdateSettingsForType(typeId, { autoSaveOnAdvance: enabled })
				.then(() => {
					settings = { ...settings, autoSaveOnAdvance: enabled };
				})
				.catch(() => {});
		} else {
			settingsStore.updateSetting('autoSaveOnAdvance', enabled);
		}
	}

	async function handleGridSizeChange(value: 'small' | 'medium' | 'large') {
		gridSizeSetting = value;
		selection.setGridSize(value);
		if (typeId) {
			await apiUpdateSettingsForType(typeId, { gridSize: value });
			settings = { ...settings, gridSize: value };
		} else {
			await settingsStore.updateSetting('gridSize', value);
		}
	}

	async function handleResetToDefaults() {
		if (typeId) {
			await apiUpdateSettingsForType(typeId, {
				gridSize: 'medium',
				autoAdvanceToNextUnlinked: false,
				autoSaveOnAdvance: false
			});
			settings = {
				...settings,
				gridSize: 'medium',
				autoAdvanceToNextUnlinked: false,
				autoSaveOnAdvance: false
			};
		} else {
			await settingsStore.resetToDefaults();
		}
		resetToDefaultsOpen = false;
	}
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
			{typeId
				? 'Project and global settings. Stored in settings.json for this project.'
				: 'Manage your settings here. Stored in settings.json in your images folder.'}
		</Dialog.Description>
		{#if typeId}
			<!-- Tabs: Project settings | Global settings -->
			<div class="flex border-b gap-1 mt-2">
				<button
					type="button"
					class="px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors {activeTab ===
					'project'
						? 'border-primary text-foreground'
						: 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => (activeTab = 'project')}
				>
					Project settings
				</button>
				<button
					type="button"
					class="px-3 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors {activeTab ===
					'global'
						? 'border-primary text-foreground'
						: 'border-transparent text-muted-foreground hover:text-foreground'}"
					onclick={() => (activeTab = 'global')}
				>
					Global settings
				</button>
			</div>
			<div class="flex flex-col gap-4 py-4">
				{#if activeTab === 'project'}
					<div class="flex flex-col gap-4">
						<div class="flex flex-col gap-2">
							<h3 class="text-lg font-bold">Navigation</h3>
							<div class="flex flex-col gap-2">
								{#if kind === 'images' || browseFirst}
									<div class="flex flex-row gap-2 items-center">
										<Checkbox
											id="auto-advance"
											checked={settings.autoAdvanceToNextUnlinked}
											onCheckedChange={(checked) => handleAutoAdvanceChange(!!checked)}
										/>
										<Label for="auto-advance">Auto-advance to next unlinked {itemLabel}</Label>
									</div>
								{/if}
								<div class="flex flex-row gap-2 items-center">
									<Checkbox
										id="auto-save-advance"
										checked={settings.autoSaveOnAdvance}
										onCheckedChange={(checked) => handleAutoSaveOnAdvanceChange(!!checked)}
									/>
									<Label for="auto-save-advance"
										>Auto-save when advancing to next/previous {itemLabel}</Label
									>
								</div>
							</div>
						</div>
						<Separator />
						<div class="flex flex-col gap-2">
							<h3 class="text-lg font-bold">Grid</h3>
							<div class="flex flex-row gap-2 items-center">
								<Label for="grid-size-setting" class="shrink-0">Grid size</Label>
								<Select.Root
									type="single"
									value={gridSizeSetting}
									onValueChange={(v) => {
										if (v) {
											gridSizeSetting = v as 'small' | 'medium' | 'large';
											selection.setGridSize(gridSizeSetting);
											apiUpdateSettingsForType(typeId, { gridSize: gridSizeSetting })
												.then(() => {
													settings = { ...settings, gridSize: gridSizeSetting };
												})
												.catch(() => {});
										}
									}}
								>
									<Select.Trigger id="grid-size-setting" class="w-[120px]">
										{gridSizeSetting === 'small'
											? 'Small'
											: gridSizeSetting === 'large'
												? 'Large'
												: 'Medium'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="small">Small</Select.Item>
										<Select.Item value="medium">Medium</Select.Item>
										<Select.Item value="large">Large</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
						</div>
					</div>
				{:else}
					<AppearanceSettings />
				{/if}
			</div>
			<Separator />
			<Dialog.Footer>
				{#if activeTab === 'project'}
					<AlertDialog.Root bind:open={resetToDefaultsOpen}>
						<AlertDialog.Trigger>
							<Button variant="outline" class="btn btn-secondary">Reset to Defaults</Button>
						</AlertDialog.Trigger>
						<AlertDialog.Content>
							<AlertDialog.Title>Reset to Defaults</AlertDialog.Title>
							<AlertDialog.Description>
								Are you sure you want to reset project settings to their default values?
							</AlertDialog.Description>
							<div class="flex justify-end">
								<form
									onsubmit={(e) => {
										e.preventDefault();
										handleResetToDefaults();
									}}
									class="flex gap-2"
								>
									<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
									<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
								</form>
							</div>
						</AlertDialog.Content>
					</AlertDialog.Root>
				{/if}
				<Button
					variant="default"
					class="btn btn-primary"
					type="button"
					onclick={() => (isOpen = false)}
				>
					Done
				</Button>
			</Dialog.Footer>
		{:else}
			<!-- No typeId: single pane (legacy / edge case) -->
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<h3 class="text-lg font-bold">Navigation</h3>
					<div class="flex flex-col gap-2">
						<div class="flex flex-row gap-2 items-center">
							<Checkbox
								id="auto-advance-global"
								checked={settings.autoAdvanceToNextUnlinked}
								onCheckedChange={(checked) => handleAutoAdvanceChange(!!checked)}
							/>
							<Label for="auto-advance-global">Auto-advance to next unlinked image</Label>
						</div>
						<div class="flex flex-row gap-2 items-center">
							<Checkbox
								id="auto-save-advance-global"
								checked={settings.autoSaveOnAdvance}
								onCheckedChange={(checked) => handleAutoSaveOnAdvanceChange(!!checked)}
							/>
							<Label for="auto-save-advance-global"
								>Auto-save when advancing to next/previous image</Label
							>
						</div>
					</div>
				</div>
				<Separator />
				<div class="flex flex-col gap-2">
					<h3 class="text-lg font-bold">Grid</h3>
					<div class="flex flex-row gap-2 items-center">
						<Label for="grid-size-setting" class="shrink-0">Grid size</Label>
						<Select.Root
							type="single"
							value={gridSizeSetting}
							onValueChange={(v) => {
								if (v) {
									gridSizeSetting = v as 'small' | 'medium' | 'large';
									selection.setGridSize(gridSizeSetting);
									settingsStore.updateSetting('gridSize', gridSizeSetting);
								}
							}}
						>
							<Select.Trigger id="grid-size-setting" class="w-[120px]">
								{gridSizeSetting === 'small'
									? 'Small'
									: gridSizeSetting === 'large'
										? 'Large'
										: 'Medium'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="small">Small</Select.Item>
								<Select.Item value="medium">Medium</Select.Item>
								<Select.Item value="large">Large</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				<Separator />
				<AppearanceSettings />
			</div>
			<Separator />
			<Dialog.Footer>
				<AlertDialog.Root bind:open={resetToDefaultsOpen}>
					<AlertDialog.Trigger>
						<Button variant="outline" class="btn btn-secondary">Reset to Defaults</Button>
					</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Title>Reset to Defaults</AlertDialog.Title>
						<AlertDialog.Description>
							Are you sure you want to reset all settings to their default values?
						</AlertDialog.Description>
						<div class="flex justify-end">
							<form
								onsubmit={(e) => {
									e.preventDefault();
									handleResetToDefaults();
								}}
								class="flex gap-2"
							>
								<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
								<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
							</form>
						</div>
					</AlertDialog.Content>
				</AlertDialog.Root>
				<Button
					variant="default"
					class="btn btn-primary"
					type="button"
					onclick={() => (isOpen = false)}
				>
					Done
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
