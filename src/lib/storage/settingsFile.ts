import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonFileAtomic } from './json.js';
import type { SchemaDefinition } from '$lib/core/types.js';


/** Default data filename for image media types. */
export const DEFAULT_DATA_FILENAME_IMAGES = 'image-data.json';
/** Default data filename for JSON media types. */
export const DEFAULT_DATA_FILENAME_JSON = 'data.json';

/**
 * Media type kind: images (files + metadata) or json (metadata only).
 */
export type MediaTypeKind = 'images' | 'json' | 'generic' | 'blob_store';

/**
 * Settings stored in settings.json at the root of each media-type folder (new multi-type layout).
 * Contains display name, kind, embedded schema, and app preferences.
 *
 * @param displayName - Human-readable name for the media type
 * @param kind - 'images' | 'json' | 'generic' | 'blob_store' (global files/ browse-only)
 * @param schema - Field definitions (embedded; no separate schema.json)
 * @param dataFileName - Filename for metadata JSON (default per kind)
 * @param gridSize - Grid cell size (app preference)
 * @param autoAdvanceToNextUnlinked - When true, auto-advance to next unlinked after save (images)
 * @param autoSaveOnAdvance - When true, save before navigating to prev/next (images)
 */
export interface MediaTypeSettingsFile {
	displayName?: string;
	kind: MediaTypeKind;
	schema?: SchemaDefinition;
	dataFileName?: string;
	gridSize?: 'small' | 'medium' | 'large';
	autoAdvanceToNextUnlinked?: boolean;
	autoSaveOnAdvance?: boolean;
	excludedFiles?: string[];
}

/**
 * Default values for media-type settings (per kind).
 */
const DEFAULT_MEDIA_TYPE_SETTINGS: Record<
	MediaTypeKind,
	Pick<MediaTypeSettingsFile, 'dataFileName'>
> = {
	images: { dataFileName: DEFAULT_DATA_FILENAME_IMAGES },
	json: { dataFileName: DEFAULT_DATA_FILENAME_JSON },
	generic: { dataFileName: DEFAULT_DATA_FILENAME_JSON },
	blob_store: { dataFileName: DEFAULT_DATA_FILENAME_IMAGES }
};

/**
 * Read media-type settings from {baseDir}/settings.json (new merged format).
 * Returns null if the file does not exist or does not contain valid kind + schema (not a valid media-type folder).
 *
 * @param baseDir - Absolute path to the media-type folder (e.g. root/images)
 * @returns Parsed settings merged with defaults, or null if invalid/missing
 */
export function readMediaTypeSettingsFileSync(baseDir: string): MediaTypeSettingsFile | null {
	const settingsPath = path.join(baseDir, 'settings.json');
	try {
		const raw = fssync.readFileSync(settingsPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const kind =
			parsed.kind === 'images' || parsed.kind === 'json' || parsed.kind === 'generic' || parsed.kind === 'blob_store'
				? parsed.kind
				: null;
		const schema = parsed.schema && typeof parsed.schema === 'object' && !Array.isArray(parsed.schema) ? (parsed.schema as SchemaDefinition) : undefined;
		if (!kind) return null;
		if (kind !== 'generic' && kind !== 'blob_store' && !schema) return null;
		const defaults = DEFAULT_MEDIA_TYPE_SETTINGS[kind];
		return {
			displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
			kind,
			schema: schema ?? {},
			dataFileName: typeof parsed.dataFileName === 'string' ? parsed.dataFileName : defaults.dataFileName,
			gridSize: ['small', 'medium', 'large'].includes(parsed.gridSize as string) ? (parsed.gridSize as 'small' | 'medium' | 'large') : 'medium',
			autoAdvanceToNextUnlinked: typeof parsed.autoAdvanceToNextUnlinked === 'boolean' ? parsed.autoAdvanceToNextUnlinked : false,
			autoSaveOnAdvance: typeof parsed.autoSaveOnAdvance === 'boolean' ? parsed.autoSaveOnAdvance : false,
			excludedFiles: Array.isArray(parsed.excludedFiles) ? parsed.excludedFiles.filter(item => typeof item === 'string') : []
		};
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return null;
		throw err;
	}
}

/**
 * Write media-type settings to {baseDir}/settings.json.
 * Merges with existing settings when present; only provided keys are updated.
 * When creating a new media type (no existing file), pass at least kind and schema.
 *
 * @param baseDir - Absolute path to the media-type folder
 * @param patch - Partial settings to merge, or full settings when creating (must include kind and schema)
 */
export async function writeMediaTypeSettingsFile(
	baseDir: string,
	patch: Partial<MediaTypeSettingsFile> & { kind: MediaTypeKind; schema?: SchemaDefinition }
): Promise<MediaTypeSettingsFile> {
	const current = readMediaTypeSettingsFileSync(baseDir);
	const defaults = DEFAULT_MEDIA_TYPE_SETTINGS[patch.kind];
	const merged: MediaTypeSettingsFile = current
		? { ...current, ...patch }
		: {
			displayName: patch.displayName,
			kind: patch.kind,
			schema: patch.schema ?? {},
			dataFileName: patch.dataFileName ?? defaults?.dataFileName,
			gridSize: patch.gridSize ?? 'medium',
			autoAdvanceToNextUnlinked: patch.autoAdvanceToNextUnlinked ?? false,
			autoSaveOnAdvance: patch.autoSaveOnAdvance ?? false,
			excludedFiles: patch.excludedFiles ?? []
		};
	const settingsPath = path.join(baseDir, 'settings.json');
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	await writeJsonFileAtomic(settingsPath, merged);
	return merged;
}


