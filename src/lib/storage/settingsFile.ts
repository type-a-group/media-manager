import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonFileAtomic } from './json.js';
import type { SchemaDefinition } from '$lib/core/types.js';

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
 * @param displayField - The schema field used to title each record row in the Records Explorer list
 *   ("title by"). Persisted so the choice sticks across type switches — the records-side analogue of
 *   {@link ClassConfig.displayField}. Absent ⇒ fall back to the `name` field / first string field.
 * @param subtitleField - Optional schema field rendered as the muted secondary line under each record
 *   row ("subtitle by"). Persisted like {@link displayField}; absent ⇒ no subtitle (single-line rows).
 * @param sortField - The list sort key (Item 9): a built-in (`name` | `last_modified`) or a schema
 *   field key. Persisted per-type, like {@link displayField}; absent ⇒ the default (`last_modified`).
 * @param sortDir - Sort direction (`asc` | `desc`); absent ⇒ `desc` (most recent first).
 *
 * Grid size and navigation prefs are **global** app settings (`<root>/settings.json` via
 * `mediaSettings.ts`), not per-type — they are intentionally absent here. The records JSON is always
 * `data.json` (the configurable `dataFileName` was dropped in Item 18).
 */
export interface MediaTypeSettingsFile {
	displayName?: string;
	kind: MediaTypeKind;
	schema?: SchemaDefinition;
	displayField?: string;
	subtitleField?: string;
	sortField?: string;
	sortDir?: 'asc' | 'desc';
	/** Optional per-type icon — a curated Lucide id (see `core/icons.ts`); absent ⇒ generic fallback. */
	icon?: string;
	/** Verbose grid (Item 8): when true the record list shows each row's `verboseFields` as key/value rows. */
	verbose?: boolean;
	/** Verbose grid (Item 8): the schema field keys (≤ `MAX_VERBOSE_FIELDS`) shown per row when `verbose`. */
	verboseFields?: string[];
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
			displayField: typeof parsed.displayField === 'string' ? parsed.displayField : undefined,
			subtitleField: typeof parsed.subtitleField === 'string' ? parsed.subtitleField : undefined,
			sortField: typeof parsed.sortField === 'string' ? parsed.sortField : undefined,
			sortDir: parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : undefined,
			icon: typeof parsed.icon === 'string' ? parsed.icon : undefined,
			verbose: typeof parsed.verbose === 'boolean' ? parsed.verbose : undefined,
			verboseFields: Array.isArray(parsed.verboseFields)
				? (parsed.verboseFields.filter((f) => typeof f === 'string') as string[])
				: undefined
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
				displayField: patch.displayField,
				subtitleField: patch.subtitleField,
				sortField: patch.sortField,
				sortDir: patch.sortDir,
				icon: patch.icon,
				verbose: patch.verbose,
				verboseFields: patch.verboseFields
			};
	const settingsPath = path.join(baseDir, 'settings.json');
	await fs.mkdir(path.dirname(settingsPath), { recursive: true });
	await writeJsonFileAtomic(settingsPath, merged);
	return merged;
}
