import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { getRootDir, listMediaTypeIds } from './paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from './settingsFile.js';
import type { MediaTypeKind } from './settingsFile.js';
import { writeJsonFileAtomic } from './json.js';
import { DEFAULT_FILES_SUBDIR } from './settingsFile.js';
import type { SchemaDefinition } from '$lib/core/types.js';

/**
 * Media type summary returned by listMediaTypes (id = folder name).
 */
export interface MediaTypeSummary {
	id: string;
	displayName: string;
	kind: MediaTypeKind;
}

/**
 * List all valid media types under the root with display name and kind.
 *
 * @returns Array of { id, displayName, kind } in no guaranteed order
 */
export function listMediaTypes(): MediaTypeSummary[] {
	const ids = listMediaTypeIds();
	const rootDir = getRootDir();
	const result: MediaTypeSummary[] = [];
	for (const id of ids) {
		const baseDir = path.join(rootDir, id);
		const settings = readMediaTypeSettingsFileSync(baseDir);
		if (!settings) continue;
		result.push({
			id,
			displayName: settings.displayName ?? id,
			kind: settings.kind
		});
	}
	return result;
}

/**
 * Slugify a display name for use as folder name (typeId).
 * Lowercase, replace non-alphanumeric with hyphen, collapse hyphens, trim.
 */
function slugify(displayName: string): string {
	return displayName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'media';
}

/**
 * Create a new media type folder with settings.json and empty data file.
 * For kind 'images', also creates the files subdirectory.
 *
 * @param displayName - Human-readable name (used to derive slug if unique)
 * @param kind - 'images' | 'json'
 * @returns The typeId (folder name) of the created media type
 * @throws If slug would be empty or folder already exists
 */
export async function createMediaType(
	displayName: string,
	kind: MediaTypeKind
): Promise<string> {
	const rootDir = getRootDir();
	let typeId = slugify(displayName);
	if (!typeId) typeId = 'media';
	const baseDir = path.join(rootDir, typeId);

	// Ensure unique: if folder exists, append number
	let candidate = typeId;
	let n = 1;
	while (fssync.existsSync(path.join(rootDir, candidate))) {
		candidate = `${typeId}-${n}`;
		n++;
	}
	typeId = candidate;
	const finalBaseDir = path.join(rootDir, typeId);

	await fs.mkdir(finalBaseDir, { recursive: true });

	const dataFileName = kind === 'images' ? 'image-data.json' : 'data.json';
	const dataPath = path.join(finalBaseDir, dataFileName);

	/** Default schema: images get image_name; JSON gets name for list/grid display. */
	const defaultSchema =
		kind === 'images'
			? {
				image_name: {
					type: 'string' as const,
					removable: false,
					defaultValue: ''
				}
			}
			: {
				name: {
					type: 'string' as const,
					removable: false,
					defaultValue: ''
				}
			};

	await writeMediaTypeSettingsFile(finalBaseDir, {
		displayName: displayName.trim() || typeId,
		kind,
		schema: defaultSchema as unknown as SchemaDefinition,
		dataFileName,
		...(kind === 'images' ? { filesSubdir: DEFAULT_FILES_SUBDIR } : {})
	});

	if (kind === 'images') {
		await writeJsonFileAtomic(dataPath, { images: [] });
		const filesDir = path.join(finalBaseDir, DEFAULT_FILES_SUBDIR);
		await fs.mkdir(filesDir, { recursive: true });
	} else {
		await writeJsonFileAtomic(dataPath, { records: [] });
	}

	return typeId;
}

/**
 * Delete a media type folder and all its contents.
 * Caller must ensure path is under root and looks like our structure (e.g. contains settings.json).
 *
 * @param typeId - Folder name under root
 * @throws If typeId is invalid or path is outside root
 */
export async function deleteMediaType(typeId: string): Promise<void> {
	if (typeId === 'files') {
		throw new Error('Cannot delete the protected "files" media type');
	}
	const rootDir = getRootDir();
	const baseDir = path.join(rootDir, typeId);
	const resolvedBase = path.resolve(baseDir);
	const resolvedRoot = path.resolve(rootDir);
	if (!resolvedBase.startsWith(resolvedRoot) || resolvedBase === resolvedRoot) {
		throw new Error('Invalid media type path');
	}
	const settingsPath = path.join(baseDir, 'settings.json');
	if (!fssync.existsSync(settingsPath)) {
		throw new Error('Not a media type folder');
	}
	await fs.rm(baseDir, { recursive: true, force: true });
}

/**
 * Ensures the default "files" media group exists.
 */
export async function ensureFilesGroupExists(): Promise<void> {
	const rootDir = getRootDir();
	const _candidate = 'files';
	const baseDir = path.join(rootDir, _candidate);
	const settingsPath = path.join(baseDir, 'settings.json');

	if (!fssync.existsSync(settingsPath)) {
		await fs.mkdir(baseDir, { recursive: true });

		await writeJsonFileAtomic(settingsPath, {
			displayName: 'Files',
			kind: 'generic'
		});
	}
}

/**
 * Ensures the default "globals" media group exists.
 */
export async function ensureGlobalsGroupExists(): Promise<void> {
	const rootDir = getRootDir();
	const _candidate = 'globals';
	const baseDir = path.join(rootDir, _candidate);
	const settingsPath = path.join(baseDir, 'settings.json');

	if (!fssync.existsSync(settingsPath)) {
		await fs.mkdir(baseDir, { recursive: true });
		const dataFileName = 'data.json';
		const dataPath = path.join(baseDir, dataFileName);

		const defaultSchema = {
			name: {
				type: 'string' as const,
				removable: false,
				defaultValue: ''
			}
		};

		await writeMediaTypeSettingsFile(baseDir, {
			displayName: 'Globals',
			kind: 'json',
			schema: defaultSchema as unknown as SchemaDefinition,
			dataFileName
		});

		// Create a default record for the key-value store
		await writeJsonFileAtomic(dataPath, {
			records: [
				{
					id: 'global-settings',
					name: 'Global Settings'
				}
			]
		});
	}
}
