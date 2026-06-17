import { writable } from 'svelte/store';

/**
 * Settings stored in settings.json (folder-based).
 * Excludes legacy file-name overrides (imageDataFileName, schemaFileName); those are no longer configurable in UI.
 *
 * @param autoAdvanceToNextUnlinked - When true, after saving an unlinked image,
 *   automatically navigate to the next unlinked image in the current list
 * @param autoSaveOnAdvance - When true, save current edits before navigating to prev/next image
 * @param gridSize - Grid cell size: small | medium | large
 */
export interface AppSettings {
	autoAdvanceToNextUnlinked: boolean;
	autoSaveOnAdvance: boolean;
	gridSize: 'small' | 'medium' | 'large';
}

/**
 * Default settings configuration
 */
const defaultSettings: AppSettings = {
	autoAdvanceToNextUnlinked: false,
	autoSaveOnAdvance: false,
	gridSize: 'medium'
};

/**
 * Create the settings store.
 * Settings are persisted in settings.json (via API) and fetched on init.
 *
 * Concerns / future improvements:
 * - Add loading/error state for fetch failures.
 */
function createSettingsStore() {
	const { subscribe, set, update } = writable<AppSettings>(defaultSettings);

	/**
	 * Fetch settings from the API and update the store.
	 */
	async function fetchSettings(): Promise<void> {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				const data = await res.json();
				set({
					autoAdvanceToNextUnlinked: data.autoAdvanceToNextUnlinked ?? false,
					autoSaveOnAdvance: data.autoSaveOnAdvance ?? false,
					gridSize: ['small', 'medium', 'large'].includes(data.gridSize) ? data.gridSize : 'medium'
				});
			}
		} catch (err) {
			console.warn('Failed to fetch settings, using defaults:', err);
		}
	}

	/**
	 * Update a setting and persist to the server.
	 */
	async function updateSetting<K extends keyof AppSettings>(
		key: K,
		value: AppSettings[K]
	): Promise<void> {
		update((s) => ({ ...s, [key]: value }));
		try {
			await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ [key]: value })
			});
		} catch (err) {
			console.warn('Failed to persist setting:', err);
		}
	}

	/**
	 * Reset all settings to defaults and persist.
	 */
	async function resetToDefaults(): Promise<void> {
		set(defaultSettings);
		try {
			await fetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(defaultSettings)
			});
		} catch (err) {
			console.warn('Failed to reset settings:', err);
		}
	}

	/**
	 * Get current settings synchronously (from store state).
	 */
	function getCurrentSettings(): AppSettings {
		let current = defaultSettings;
		const unsub = subscribe((s) => {
			current = s;
		});
		unsub();
		return current;
	}

	return {
		subscribe,
		fetchSettings,
		updateSetting,
		resetToDefaults,
		getCurrentSettings
	};
}

export const settingsStore = createSettingsStore();
