import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import path from 'node:path';
import { getRootDir, listMediaTypeIds } from './paths.js';
import { readMediaTypeSettingsFileSync, writeMediaTypeSettingsFile } from './settingsFile.js';
import type { MediaTypeKind } from './settingsFile.js';
import { writeJsonFileAtomic } from './json.js';
import type { SchemaDefinition } from '$lib/core/types.js';

/** Canonical globals singleton record id (must satisfy ImageIdSchema UUID validation). */
export const GLOBALS_RECORD_ID = '00000000-0000-4000-8000-000000000001' as const;

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
 * For kind 'images', also creates the files subdirectory. For 'generic', files live in the folder root (no subdir).
 *
 * @param displayName - Human-readable name (used to derive slug if unique)
 * @param kind - 'images' | 'json' | 'generic' (generic: files in type folder, optional schema)
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
	const PROTECTED_TYPE_IDS = new Set(['files', 'globals']);
	if (PROTECTED_TYPE_IDS.has(typeId)) {
		throw new Error(`"${typeId}" is a reserved name and cannot be used for a media type`);
	}
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

	/** Default schema: images get image_name; JSON gets name; generic starts empty. */
	const defaultSchema: SchemaDefinition =
		kind === 'images'
			? ({
					image_name: {
						type: 'string' as const,
						removable: false,
						defaultValue: ''
					}
				} as unknown as SchemaDefinition)
			: kind === 'generic'
				? {}
				: ({
						name: {
							type: 'string' as const,
							removable: false,
							defaultValue: ''
						}
					} as unknown as SchemaDefinition);

	await writeMediaTypeSettingsFile(finalBaseDir, {
		displayName: displayName.trim() || typeId,
		kind,
		schema: defaultSchema,
		dataFileName,
	});

	if (kind === 'images') {
		await writeJsonFileAtomic(dataPath, { images: [] });
	} else if (kind === 'generic') {
		await writeJsonFileAtomic(dataPath, { files: [] });
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
	if (typeId === 'globals') {
		throw new Error('Cannot delete the protected "globals" media type');
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
			kind: 'blob_store'
		});
		return;
	}

	/** Upgrade legacy auto-created group from generic → blob_store (global `files/` catalog layout). */
	const existing = readMediaTypeSettingsFileSync(baseDir);
	if (existing && _candidate === 'files' && existing.kind === 'generic') {
		await writeMediaTypeSettingsFile(baseDir, {
			kind: 'blob_store',
			displayName: existing.displayName ?? 'Files',
			schema: {}
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

		await writeMediaTypeSettingsFile(baseDir, {
			displayName: 'Globals',
			kind: 'json',
			schema: {},
			dataFileName
		});

		await writeJsonFileAtomic(dataPath, {
			records: [{ id: GLOBALS_RECORD_ID }]
		});
		return;
	}

	const dataPath = path.join(baseDir, 'data.json');
	let records: unknown[] = [];
	try {
		const raw = JSON.parse(await fs.readFile(dataPath, 'utf-8')) as { records?: unknown[] };
		records = Array.isArray(raw.records) ? raw.records : [];
	} catch {
		records = [];
	}

	// Already healthy: exactly one record with the canonical ID
	if (
		records.length === 1 &&
		!!records[0] &&
		typeof records[0] === 'object' &&
		(records[0] as Record<string, unknown>).id === GLOBALS_RECORD_ID
	) {
		return;
	}

	// Heal: find the canonical record (or fall back to first), preserve its data, force correct id
	const canonical =
		(records.find(
			(r) =>
				!!r &&
				typeof r === 'object' &&
				'id' in (r as Record<string, unknown>) &&
				(r as Record<string, unknown>).id === GLOBALS_RECORD_ID
		) as Record<string, unknown> | undefined) ??
		(records[0] && typeof records[0] === 'object' ? (records[0] as Record<string, unknown>) : null);
	const healed: Record<string, unknown> = { ...(canonical ?? {}), id: GLOBALS_RECORD_ID };
	// Remove legacy name field if it is just the auto-generated placeholder
	if (healed.name === 'Global Settings') delete healed.name;
	await writeJsonFileAtomic(dataPath, { records: [healed] });
}
