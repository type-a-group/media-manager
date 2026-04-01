import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonFileAtomic } from './json.js';
import type { SchemaDefinition } from '$lib/core/types.js';

/**
 * Default settings values used when settings.json does not exist.
 */
export const DEFAULT_IMAGE_DATA_FILENAME = 'image-data.json';
export const DEFAULT_SCHEMA_FILENAME = 'schema.json';

/** Default data filename for image media types. */
export const DEFAULT_DATA_FILENAME_IMAGES = 'image-data.json';
/** Default data filename for JSON media types. */
export const DEFAULT_DATA_FILENAME_JSON = 'data.json';
/** Default subfolder name for image files within an images media type. */
export const DEFAULT_FILES_SUBDIR = 'files';

/**
 * Media type kind: images (files + metadata) or json (metadata only).
 */
export type MediaTypeKind = 'images' | 'json' | 'generic';

/**
 * Settings stored in settings.json at the root of each media-type folder (new multi-type layout).
 * Contains display name, kind, embedded schema, and app preferences.
 *
 * @param displayName - Human-readable name for the media type
 * @param kind - 'images' | 'json' | 'generic'
 * @param schema - Field definitions (embedded; no separate schema.json)
 * @param dataFileName - Filename for metadata JSON (default per kind)
 * @param filesSubdir - Subfolder for image files (images kind only; default: files)
 * @param gridSize - Grid cell size (app preference)
 * @param autoAdvanceToNextUnlinked - When true, auto-advance to next unlinked after save (images)
 * @param autoSaveOnAdvance - When true, save before navigating to prev/next (images)
 */
export interface MediaTypeSettingsFile {
	displayName?: string;
	kind: MediaTypeKind;
	schema?: SchemaDefinition;
	dataFileName?: string;
	filesSubdir?: string;
	gridSize?: 'small' | 'medium' | 'large';
	autoAdvanceToNextUnlinked?: boolean;
	autoSaveOnAdvance?: boolean;
	excludedFiles?: string[];
}

/**
 * Default values for media-type settings (per kind).
 */
const DEFAULT_MEDIA_TYPE_SETTINGS: Record<MediaTypeKind, Pick<MediaTypeSettingsFile, 'dataFileName' | 'filesSubdir'>> = {
	images: { dataFileName: DEFAULT_DATA_FILENAME_IMAGES, filesSubdir: DEFAULT_FILES_SUBDIR },
	json: { dataFileName: DEFAULT_DATA_FILENAME_JSON },
	generic: { dataFileName: DEFAULT_DATA_FILENAME_JSON }
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
		const kind = parsed.kind === 'images' || parsed.kind === 'json' || parsed.kind === 'generic' ? parsed.kind : null;
		const schema = parsed.schema && typeof parsed.schema === 'object' && !Array.isArray(parsed.schema) ? (parsed.schema as SchemaDefinition) : undefined;
		if (!kind) return null;
		if (kind !== 'generic' && !schema) return null;
		const defaults = DEFAULT_MEDIA_TYPE_SETTINGS[kind];
		return {
			displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
			kind,
			schema: schema ?? {},
			dataFileName: typeof parsed.dataFileName === 'string' ? parsed.dataFileName : defaults.dataFileName,
			filesSubdir: kind === 'images' ? (typeof parsed.filesSubdir === 'string' ? parsed.filesSubdir : defaults.filesSubdir) : undefined,
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
			filesSubdir: patch.kind === 'images' ? (patch.filesSubdir ?? defaults?.filesSubdir) : undefined,
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

/**
 * Settings stored in settings.json at the base of the images directory (legacy single-folder layout).
 *
 * @param imageDataFileName - Filename for image metadata (default: image-data.json)
 * @param schemaFileName - Filename for schema definition (default: schema.json)
 * @param autoAdvanceToNextUnlinked - When true, auto-advance to next unlinked after save
 * @param autoSaveOnAdvance - When true, save before navigating to prev/next image
 * @param gridSize - Grid cell size: 'small' | 'medium' | 'large'
 */
export interface SettingsFileContent {
	imageDataFileName?: string;
	schemaFileName?: string;
	autoAdvanceToNextUnlinked?: boolean;
	autoSaveOnAdvance?: boolean;
	gridSize?: 'small' | 'medium' | 'large';
}

const DEFAULT_SETTINGS: SettingsFileContent = {
	imageDataFileName: DEFAULT_IMAGE_DATA_FILENAME,
	schemaFileName: DEFAULT_SCHEMA_FILENAME,
	autoAdvanceToNextUnlinked: false,
	autoSaveOnAdvance: false,
	gridSize: 'medium'
};

/**
 * Read settings from {baseDir}/settings.json synchronously.
 * If the file does not exist, returns defaults without creating the file.
 *
 * @param baseDir - Absolute path to the images directory root
 * @returns Parsed settings merged with defaults
 *
 * Concerns / future improvements:
 * - Consider creating settings.json with defaults on first run.
 */
export function readSettingsFileSync(baseDir: string): SettingsFileContent {
	const settingsPath = path.join(baseDir, 'settings.json');
	try {
		const raw = fssync.readFileSync(settingsPath, 'utf-8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			...DEFAULT_SETTINGS,
			imageDataFileName: typeof parsed.imageDataFileName === 'string' ? parsed.imageDataFileName : DEFAULT_SETTINGS.imageDataFileName,
			schemaFileName: typeof parsed.schemaFileName === 'string' ? parsed.schemaFileName : DEFAULT_SETTINGS.schemaFileName,
			autoAdvanceToNextUnlinked: typeof parsed.autoAdvanceToNextUnlinked === 'boolean' ? parsed.autoAdvanceToNextUnlinked : DEFAULT_SETTINGS.autoAdvanceToNextUnlinked,
			autoSaveOnAdvance: typeof parsed.autoSaveOnAdvance === 'boolean' ? parsed.autoSaveOnAdvance : DEFAULT_SETTINGS.autoSaveOnAdvance,
			gridSize: ['small', 'medium', 'large'].includes(parsed.gridSize as string) ? (parsed.gridSize as 'small' | 'medium' | 'large') : DEFAULT_SETTINGS.gridSize
		};
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return { ...DEFAULT_SETTINGS };
		throw err;
	}
}

/**
 * Write settings to {baseDir}/settings.json.
 * Merges with existing settings; only provided keys are updated.
 *
 * @param baseDir - Absolute path to the images directory root
 * @param patch - Partial settings to merge
 *
 * Concerns / future improvements:
 * - Validate filenames (e.g. no path traversal, valid extensions).
 */
export async function writeSettingsFile(
	baseDir: string,
	patch: Partial<SettingsFileContent>
): Promise<SettingsFileContent> {
	const current = readSettingsFileSync(baseDir);
	const merged: SettingsFileContent = {
		...current,
		...patch
	};
	const settingsPath = path.join(baseDir, 'settings.json');
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	await writeJsonFileAtomic(settingsPath, merged);
	return merged;
}
