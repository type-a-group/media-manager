import path from 'node:path';
import * as fssync from 'node:fs';
import { readMediaTypeSettingsFileSync, type MediaTypeKind } from './settingsFile.js';

/**
 * On-disk layout (file-first classes redesign):
 *
 *   <root>/
 *   ├─ media/
 *   │  ├─ manifest.json     # blob registry + derived membership index
 *   │  ├─ files/            # pure blob dir, any type
 *   │  ├─ classes/<id>.json # { schema, config, records } — source of truth per class
 *   │  └─ settings.json     # media-wide prefs (views, class ordering, defaults)
 *   └─ <jsonType>/...       # `json`-kind media types stay top-level (incl. `globals`)
 *
 * `media/` is the hub for **all blobs**; a *class* is an opt-in metadata table keyed by `file_id`.
 * `json`-kind types remain top-level folders (deferred records reorg). The folder name **is** the id.
 */

/** Folder name under {@link getRootDir} that holds the whole media (blob + classes) subsystem. */
export const MEDIA_DIR_NAME = 'media' as const;
/** Folder name under {@link getMediaDir} where all blobs live. */
export const GLOBAL_FILES_DIR_NAME = 'files' as const;
/** Folder name under {@link getMediaDir} where per-class metadata files live. */
export const CLASSES_DIR_NAME = 'classes' as const;

/**
 * Resolve the root directory for the workspace (env `MEDIA_MANAGER_ROOT`).
 *
 * Use case:
 * - Single source of truth for "where is the data root".
 */
export function getRootDir(): string {
	const configured = process.env.MEDIA_MANAGER_ROOT?.trim();
	// Fallback for build: vite build loads server modules but doesn't run them.
	return configured
		? path.resolve(configured)
		: path.resolve(process.cwd(), '.media-manager-build');
}

/** Absolute path to the media subsystem root (`<root>/media`). */
export function getMediaDir(): string {
	return path.join(getRootDir(), MEDIA_DIR_NAME);
}

/** Absolute path to the global blob directory (`<root>/media/files`). */
export function getGlobalFilesDir(): string {
	return path.join(getMediaDir(), GLOBAL_FILES_DIR_NAME);
}

/** Absolute path to the global blob manifest (`<root>/media/manifest.json`). */
export function getManifestPath(): string {
	return path.join(getMediaDir(), 'manifest.json');
}

/** Absolute path to the classes directory (`<root>/media/classes`). */
export function getClassesDir(): string {
	return path.join(getMediaDir(), CLASSES_DIR_NAME);
}

/** Absolute path to a single class file (`<root>/media/classes/<id>.json`). */
export function getClassFilePath(classId: string): string {
	return path.join(getClassesDir(), `${classId}.json`);
}

/** Absolute path to the media-wide settings file (`<root>/media/settings.json`). */
export function getMediaSettingsPath(): string {
	return path.join(getMediaDir(), 'settings.json');
}

/**
 * List the ids (filename stems) of every class under `<root>/media/classes`.
 *
 * @returns Class ids in no guaranteed order (empty when the dir is absent).
 */
export function listClassIds(): string[] {
	let entries: fssync.Dirent[];
	try {
		entries = fssync.readdirSync(getClassesDir(), { withFileTypes: true });
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return [];
		throw e;
	}
	return entries
		.filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.endsWith('.lock'))
		.map((e) => e.name.slice(0, -'.json'.length));
}

/**
 * Paths for a single `json`-kind media-type folder (the records side; classes use class paths).
 */
export interface MediaTypePaths {
	rootDir: string;
	baseDir: string;
	settingsPath: string;
	dataPath: string;
	kind: MediaTypeKind;
}

/**
 * Get filesystem paths for a `json`-kind media type (by folder name / typeId).
 *
 * @param typeId - Folder name under root (e.g. 'notes', 'globals')
 * @returns Paths object; throws if folder is not a valid media-type folder
 */
export function getMediaTypePaths(typeId: string): MediaTypePaths {
	const rootDir = getRootDir();
	const baseDir = path.resolve(rootDir, typeId);
	const settingsPath = path.join(baseDir, 'settings.json');
	const settings = readMediaTypeSettingsFileSync(baseDir);
	if (!settings) {
		throw new Error(`Not a valid media-type folder: ${typeId}`);
	}
	const dataFileName = settings.dataFileName ?? 'data.json';
	const dataPath = path.join(baseDir, dataFileName);
	return { rootDir, baseDir, settingsPath, dataPath, kind: settings.kind };
}

/**
 * List typeIds of all valid top-level `json`-kind media-type folders under the root. The reserved
 * `media/` subsystem folder is skipped (it has no media-type `settings.json`).
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
		if (ent.name === MEDIA_DIR_NAME) continue;
		const settings = readMediaTypeSettingsFileSync(path.join(rootDir, ent.name));
		if (settings) typeIds.push(ent.name);
	}
	return typeIds;
}
