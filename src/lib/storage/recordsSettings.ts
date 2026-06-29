import * as fssync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { getRecordsSettingsPath } from './paths.js';
import { writeJsonFileAtomic } from './json.js';

/**
 * Records-scoped settings, persisted in `<root>/records/settings.json` (Item 18).
 *
 * The records-side mirror of `media/settings.json`: it holds cross-**type** preferences that belong
 * to the collection of record types rather than to any single type. Today its only (dormant) tenant
 * is {@link RecordsSettings.typeOrder} — the manual ordering of record types in the rail. The
 * ordering *feature* (reorder UI + sort-on-read) is Item 41; this module just establishes the file
 * and its read/write contract so the field has a home.
 *
 * @param typeOrder - Optional persisted ordering of record-type ids for the rail. Dormant until
 *   Item 41 wires it up; preserved on write.
 */
export interface RecordsSettings {
	typeOrder?: string[];
}

/** Defaults applied when `records/settings.json` is missing or a field is absent/invalid. */
export const DEFAULT_RECORDS_SETTINGS: RecordsSettings = {};

function coerce(raw: Record<string, unknown>): RecordsSettings {
	return {
		typeOrder: Array.isArray(raw.typeOrder)
			? (raw.typeOrder.filter((x) => typeof x === 'string') as string[])
			: undefined
	};
}

/**
 * Read records-scoped settings from `<root>/records/settings.json`, merged with defaults.
 * A missing or malformed file yields the defaults rather than throwing.
 */
export function readRecordsSettings(): RecordsSettings {
	try {
		const raw = JSON.parse(fssync.readFileSync(getRecordsSettingsPath(), 'utf-8')) as Record<
			string,
			unknown
		>;
		return coerce(raw);
	} catch {
		return { ...DEFAULT_RECORDS_SETTINGS };
	}
}

/**
 * Merge a partial update into `<root>/records/settings.json` and persist atomically.
 * Unknown keys already on disk are preserved.
 *
 * @param patch - The subset of settings to change.
 * @returns The full settings object after the merge.
 */
export async function writeRecordsSettings(
	patch: Partial<RecordsSettings>
): Promise<RecordsSettings> {
	const settingsPath = getRecordsSettingsPath();
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
