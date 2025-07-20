import { writable } from 'svelte/store';

/**
 * Settings store for managing application preferences
 * 
 * @param autoAdvanceToNextUnlinked - When true, after saving an unlinked image, 
 * automatically navigate to the next unlinked image in the current list
 */
export interface AppSettings {
	autoAdvanceToNextUnlinked: boolean;
}

/**
 * Default settings configuration
 */
const defaultSettings: AppSettings = {
	autoAdvanceToNextUnlinked: false
};

/**
 * Create the settings store with default values
 * Settings are persisted in localStorage and restored on page load
 */
function createSettingsStore() {
	// Try to load settings from localStorage
	const storedSettings = typeof window !== 'undefined' ? localStorage.getItem('image-manager-settings') : null;
	let initialSettings = defaultSettings;
	
	if (storedSettings) {
		try {
			initialSettings = { ...defaultSettings, ...JSON.parse(storedSettings) };
		} catch (error) {
			console.warn('Failed to parse stored settings, using defaults:', error);
		}
	}
	
	const { subscribe, set, update } = writable<AppSettings>(initialSettings);
	
	return {
		subscribe,
		
		/**
		 * Update a specific setting
		 * @param key - The setting key to update
		 * @param value - The new value for the setting
		 */
		updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
			update(settings => {
				const newSettings = { ...settings, [key]: value };
				// Persist to localStorage
				if (typeof window !== 'undefined') {
					localStorage.setItem('image-manager-settings', JSON.stringify(newSettings));
				}
				return newSettings;
			});
		},
		
		/**
		 * Reset all settings to default values
		 */
		resetToDefaults: () => {
			if (typeof window !== 'undefined') {
				localStorage.removeItem('image-manager-settings');
			}
			set(defaultSettings);
		},
		
		/**
		 * Get the current settings value synchronously
		 */
		getCurrentSettings: (): AppSettings => {
			let currentSettings = defaultSettings;
			const unsubscribe = subscribe(settings => {
				currentSettings = settings;
			});
			unsubscribe();
			return currentSettings;
		}
	};
}

export const settingsStore = createSettingsStore(); 