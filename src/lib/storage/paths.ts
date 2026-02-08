import path from 'node:path';
import * as fssync from 'node:fs';
import {
	readSettingsFileSync,
	readMediaTypeSettingsFileSync,
	type MediaTypeKind
} from './settingsFile.js';

/**
 * Resolve the root directory for all media types (env MEDIA_MANAGER_ROOT).
 * Subdirectories of this root are scanned for valid media-type folders (each with settings.json).
 *
 * Use case:
 * - Single source of truth for "where is the data root" for multi-media-type layout.
 */
export function getRootDir(): string {
	const configured = process.env.MEDIA_MANAGER_ROOT?.trim();
	// Fallback for build: vite build loads server modules but doesn't run them.
	const rootDir = configured
		? path.resolve(configured)
		: path.resolve(process.cwd(), '.media-manager-build');
	return rootDir;
}

/**
 * Result of getMediaTypePaths: paths for a single media-type folder.
 */
export interface MediaTypePaths {
	rootDir: string;
	baseDir: string;
	settingsPath: string;
	dataPath: string;
	/** Present only for kind 'images'. */
	filesDir?: string;
	kind: MediaTypeKind;
}

/**
 * Get filesystem paths for a given media type (by folder name / typeId).
 * Reads settings.json in that folder to resolve dataFileName and filesSubdir.
 *
 * @param typeId - Folder name under root (e.g. 'images', 'projects')
 * @returns Paths object; throws if folder is not a valid media-type folder
 *
 * Concerns / future improvements:
 * - Caller must ensure typeId is safe (no path traversal); validate in API layer.
 */
export function getMediaTypePaths(typeId: string): MediaTypePaths {
	const rootDir = getRootDir();
	const baseDir = path.resolve(rootDir, typeId);
	const settingsPath = path.join(baseDir, 'settings.json');
	const settings = readMediaTypeSettingsFileSync(baseDir);
	if (!settings) {
		throw new Error(`Not a valid media-type folder: ${typeId}`);
	}
	const dataFileName = settings.dataFileName ?? (settings.kind === 'images' ? 'image-data.json' : 'data.json');
	const dataPath = path.join(baseDir, dataFileName);
	const result: MediaTypePaths = {
		rootDir,
		baseDir,
		settingsPath,
		dataPath,
		kind: settings.kind
	};
	if (settings.kind === 'images') {
		result.filesDir = path.join(baseDir, settings.filesSubdir ?? 'files');
	}
	return result;
}

/**
 * List typeIds of all valid media-type folders under the root.
 * Scans the root directory; each subdirectory that contains a valid settings.json (displayName, kind, schema) is included.
 *
 * @returns Array of typeIds (folder names), in no guaranteed order
 */
export function listMediaTypeIds(): string[] {
	const rootDir = getRootDir();
	let entries: fssync.Dirent[];
	try {
		entries = fssync.readdirSync(rootDir, { withFileTypes: true });
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return [];
		throw e;
	}
	const typeIds: string[] = [];
	for (const ent of entries) {
		if (!ent.isDirectory()) continue;
		const baseDir = path.join(rootDir, ent.name);
		const settings = readMediaTypeSettingsFileSync(baseDir);
		if (settings) typeIds.push(ent.name);
	}
	return typeIds;
}

/**
 * Centralized filesystem paths for the current app storage layout (legacy single-folder).
 *
 * Use case:
 * - Avoid scattered string literals like `image-data.json`.
 * - Resolves paths from MEDIA_MANAGER_ROOT and settings.json.
 *
 * Layout:
 * - baseDir = MEDIA_MANAGER_ROOT
 * - imagesDir = baseDir/images
 * - imageDataPath = baseDir/{settings.imageDataFileName}
 * - schemaPath = baseDir/{settings.schemaFileName}
 * - settingsPath = baseDir/settings.json
 *
 * Concerns / future improvements:
 * - Kept for backward compat during refactor; prefer getRootDir + getMediaTypePaths(typeId) for new code.
 */
export function getAssetPaths() {
	const configured = process.env.MEDIA_MANAGER_ROOT?.trim();
	// Fallback for build: vite build loads server modules but doesn't run them.
	// At runtime, use the CLI (media-manager /path/to/root) or set MEDIA_MANAGER_ROOT.
	const baseDir = configured ? path.resolve(configured) : path.resolve(process.cwd(), '.media-manager-build');
	const settings = readSettingsFileSync(baseDir);
	const imageDataFileName = settings.imageDataFileName ?? 'image-data.json';
	const schemaFileName = settings.schemaFileName ?? 'schema.json';

	const imagesDir = path.resolve(baseDir, 'images');
	const imageDataPath = path.resolve(baseDir, imageDataFileName);
	const schemaPath = path.resolve(baseDir, schemaFileName);
	const settingsPath = path.resolve(baseDir, 'settings.json');

	return {
		root: process.cwd(),
		baseDir,
		assetsDir: baseDir,
		imagesDir,
		imageDataPath,
		schemaPath,
		settingsPath
	};
}
