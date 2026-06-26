import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getMediaSettingsPath } from './paths.js';
import { writeJsonFileAtomic } from './json.js';

/**
 * Media-wide app preferences, persisted in `<root>/media/settings.json`.
 *
 * This is the **single source of truth** for app-level UI preferences that used to be scattered
 * across per-class `config` and per-`json`-type `settings.json` (and a dead `/api/config/settings`
 * endpoint). Grid size and the navigation prefs are now global — one value shared by every view
 * (All Files, every class catalog, and every `json` record grid).
 *
 * @param gridSize - Grid cell size for every grid in the app: `small | medium | large`.
 * @param autoAdvanceToNextUnlinked - After saving, advance to the next item automatically.
 * @param autoSaveOnAdvance - Save pending edits before moving to the previous/next item.
 * @param railCollapsed - Whether the Records Explorer type rail starts collapsed (layout pref).
 * @param classOrder - Optional persisted class ordering for the hub sidebar (preserved on write).
 * @param sortField - The All Files hub list sort key (Item 9): a built-in (`name` | `created_at` |
 *   `size`). Hub-wide (the hub has no per-class context); class catalogs persist their own in config.
 * @param sortDir - The All Files hub sort direction; absent ⇒ `desc` (newest first).
 */
export interface MediaSettings {
	gridSize: 'small' | 'medium' | 'large';
	autoAdvanceToNextUnlinked: boolean;
	autoSaveOnAdvance: boolean;
	railCollapsed: boolean;
	classOrder?: string[];
	sortField?: string;
	sortDir?: 'asc' | 'desc';
}

/** Defaults applied when `media/settings.json` is missing or a field is absent/invalid. */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
	gridSize: 'medium',
	autoAdvanceToNextUnlinked: false,
	autoSaveOnAdvance: false,
	railCollapsed: false
};

function coerce(raw: Record<string, unknown>): MediaSettings {
	return {
		gridSize: ['small', 'medium', 'large'].includes(raw.gridSize as string)
			? (raw.gridSize as 'small' | 'medium' | 'large')
			: DEFAULT_MEDIA_SETTINGS.gridSize,
		autoAdvanceToNextUnlinked:
			typeof raw.autoAdvanceToNextUnlinked === 'boolean'
				? raw.autoAdvanceToNextUnlinked
				: DEFAULT_MEDIA_SETTINGS.autoAdvanceToNextUnlinked,
		autoSaveOnAdvance:
			typeof raw.autoSaveOnAdvance === 'boolean'
				? raw.autoSaveOnAdvance
				: DEFAULT_MEDIA_SETTINGS.autoSaveOnAdvance,
		railCollapsed:
			typeof raw.railCollapsed === 'boolean'
				? raw.railCollapsed
				: DEFAULT_MEDIA_SETTINGS.railCollapsed,
		classOrder: Array.isArray(raw.classOrder)
			? (raw.classOrder.filter((x) => typeof x === 'string') as string[])
			: undefined,
		sortField: typeof raw.sortField === 'string' ? raw.sortField : undefined,
		sortDir: raw.sortDir === 'asc' || raw.sortDir === 'desc' ? raw.sortDir : undefined
	};
}

/**
 * Read media-wide settings from `media/settings.json`, merged with defaults.
 * A missing or malformed file yields the defaults rather than throwing.
 */
export function readMediaSettings(): MediaSettings {
	try {
		const raw = JSON.parse(fssync.readFileSync(getMediaSettingsPath(), 'utf-8')) as Record<
			string,
			unknown
		>;
		return coerce(raw);
	} catch {
		return { ...DEFAULT_MEDIA_SETTINGS };
	}
}

/**
 * Merge a partial update into `media/settings.json` and persist atomically.
 * Unknown keys already on disk (e.g. `classOrder`) are preserved.
 *
 * @param patch - The subset of settings to change.
 * @returns The full settings object after the merge.
 */
export async function writeMediaSettings(patch: Partial<MediaSettings>): Promise<MediaSettings> {
	const settingsPath = getMediaSettingsPath();
	let existing: Record<string, unknown> = {};
	try {
		existing = JSON.parse(fssync.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
	} catch {
		existing = {};
	}
	const merged = { ...existing, ...patch };
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	await writeJsonFileAtomic(settingsPath, merged);
	return coerce(merged);
}
