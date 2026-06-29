import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getAppSettingsPath } from './paths.js';
import { writeJsonFileAtomic } from './json.js';

/**
 * App-wide UI preferences, persisted in `<root>/settings.json`.
 *
 * This is the **single source of truth** for app-level UI preferences that used to be scattered
 * across per-class `config` and per-`json`-type `settings.json` (and a dead `/api/config/settings`
 * endpoint). Grid size and the navigation prefs are global — one value shared by every view
 * (All Files, every class catalog, and every `json` record grid).
 *
 * Item 18 hoisted these out of the misnamed `media/settings.json` to the root `settings.json`; the
 * media-scoped `classOrder` stays in `media/settings.json` (dormant until Item 41). The
 * `MediaSettings`/`readMediaSettings`/`writeMediaSettings` names are kept for call-site stability.
 *
 * @param gridSize - Grid cell size for every grid in the app: `small | medium | large`.
 * @param autoAdvanceToNextUnlinked - After saving, advance to the next item automatically.
 * @param autoSaveOnAdvance - Save pending edits before moving to the previous/next item.
 * @param railCollapsed - Whether the Records Explorer type rail starts collapsed (layout pref).
 * @param sortField - The All Files hub list sort key (Item 9): a built-in (`name` | `created_at` |
 *   `size`). Hub-wide (the hub has no per-class context); class catalogs persist their own in config.
 * @param sortDir - The All Files hub sort direction; absent ⇒ `desc` (newest first).
 */
export interface MediaSettings {
	gridSize: 'small' | 'medium' | 'large';
	autoAdvanceToNextUnlinked: boolean;
	autoSaveOnAdvance: boolean;
	railCollapsed: boolean;
	sortField?: string;
	sortDir?: 'asc' | 'desc';
	/** Verbose grid (Item 8) for the All Files hub: show each tile's `verboseFields` as key/value rows. */
	verbose?: boolean;
	/**
	 * Verbose grid (Item 8): the intrinsic field keys shown per tile in All Files. Unlike a class catalog
	 * (schema fields), All Files holds heterogeneous blobs, so these are blob-intrinsic keys resolved
	 * client-side (`size` | `dimensions` | `type` | `created`), not schema fields.
	 */
	verboseFields?: string[];
}

/** Defaults applied when `<root>/settings.json` is missing or a field is absent/invalid. */
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
		sortField: typeof raw.sortField === 'string' ? raw.sortField : undefined,
		sortDir: raw.sortDir === 'asc' || raw.sortDir === 'desc' ? raw.sortDir : undefined,
		verbose: typeof raw.verbose === 'boolean' ? raw.verbose : undefined,
		verboseFields: Array.isArray(raw.verboseFields)
			? (raw.verboseFields.filter((x) => typeof x === 'string') as string[])
			: undefined
	};
}

/**
 * Read app-wide settings from `<root>/settings.json`, merged with defaults.
 * A missing or malformed file yields the defaults rather than throwing.
 */
export function readMediaSettings(): MediaSettings {
	try {
		const raw = JSON.parse(fssync.readFileSync(getAppSettingsPath(), 'utf-8')) as Record<
			string,
			unknown
		>;
		return coerce(raw);
	} catch {
		return { ...DEFAULT_MEDIA_SETTINGS };
	}
}

/**
 * Merge a partial update into `<root>/settings.json` and persist atomically.
 * Unknown keys already on disk are preserved.
 *
 * @param patch - The subset of settings to change.
 * @returns The full settings object after the merge.
 */
export async function writeMediaSettings(patch: Partial<MediaSettings>): Promise<MediaSettings> {
	const settingsPath = getAppSettingsPath();
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
