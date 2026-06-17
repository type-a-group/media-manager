import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonFileAtomic } from './json.js';
import type { SchemaDefinition } from '$lib/core/types.js';

/** Default data filename for `json` media types. */
export const DEFAULT_DATA_FILENAME_JSON = 'data.json';

/**
 * Media type kind. After the file-first redesign the only top-level media-type kind is `json`
 * (records, no file attachments); all file-backed catalogs are now **classes** under `media/classes/`.
 */
export type MediaTypeKind = 'json';

/**
 * Settings stored in `settings.json` at the root of each `json` media-type folder.
 *
 * @param displayName - Human-readable name for the media type
 * @param kind - Always `json`
 * @param schema - Field definitions (embedded)
 * @param dataFileName - Filename for the records JSON (default `data.json`)
 *
 * Grid size and navigation prefs are **global** app settings (`media/settings.json` via
 * `mediaSettings.ts`), not per-type — they are intentionally absent here.
 */
export interface MediaTypeSettingsFile {
	displayName?: string;
	kind: MediaTypeKind;
	schema?: SchemaDefinition;
	dataFileName?: string;
}

/**
 * Read media-type settings from `{baseDir}/settings.json`.
 * Returns null when the file is missing or is not a recognized `json` media-type folder.
 *
 * @param baseDir - Absolute path to the media-type folder (e.g. root/notes)
 * @returns Parsed settings merged with defaults, or null if invalid/missing
 */
export function readMediaTypeSettingsFileSync(baseDir: string): MediaTypeSettingsFile | null {
	const settingsPath = path.join(baseDir, 'settings.json');
	try {
		const raw = fssync.readFileSync(settingsPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (parsed.kind !== 'json') return null;
		const schema =
			parsed.schema && typeof parsed.schema === 'object' && !Array.isArray(parsed.schema)
				? (parsed.schema as SchemaDefinition)
				: {};
		return {
			displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
			kind: 'json',
			schema,
			dataFileName:
				typeof parsed.dataFileName === 'string' ? parsed.dataFileName : DEFAULT_DATA_FILENAME_JSON
		};
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return null;
		throw err;
	}
}

/**
 * Write media-type settings to `{baseDir}/settings.json`, merging with any existing file.
 *
 * @param baseDir - Absolute path to the media-type folder
 * @param patch - Partial settings to merge (must include kind when creating)
 */
export async function writeMediaTypeSettingsFile(
	baseDir: string,
	patch: Partial<MediaTypeSettingsFile> & { kind: MediaTypeKind; schema?: SchemaDefinition }
): Promise<MediaTypeSettingsFile> {
	const current = readMediaTypeSettingsFileSync(baseDir);
	const merged: MediaTypeSettingsFile = current
		? { ...current, ...patch }
		: {
				displayName: patch.displayName,
				kind: patch.kind,
				schema: patch.schema ?? {},
				dataFileName: patch.dataFileName ?? DEFAULT_DATA_FILENAME_JSON
			};
	const settingsPath = path.join(baseDir, 'settings.json');
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	await writeJsonFileAtomic(settingsPath, merged);
	return merged;
}
