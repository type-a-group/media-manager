import * as fssync from 'node:fs';
import path from 'node:path';
import {
	getRootDir,
	getMediaSettingsPath,
	MEDIA_DIR_NAME,
	RECORDS_DIR_NAME,
	GLOBALS_TYPE_ID
} from './paths.js';
import { readMediaTypeSettingsFileSync } from './settingsFile.js';

/**
 * App-wide preference keys that belong in `<root>/settings.json` after the Item 18 reorg. If any of
 * these still live in `media/settings.json`, that root predates the settings hoist.
 */
const APP_WIDE_SETTINGS_KEYS = [
	'gridSize',
	'autoAdvanceToNextUnlinked',
	'autoSaveOnAdvance',
	'railCollapsed',
	'sortField',
	'sortDir',
	'verbose',
	'verboseFields'
] as const;

/**
 * Detect whether the data root is in the **pre-Item-18 (flat) layout**, returning a human-readable
 * reason or `null` when the layout is current.
 *
 * Two read-only signals (either ⇒ old layout):
 * - **A** — a non-reserved top-level directory that is a valid `json` media-type folder (a record
 *   type that hasn't moved under `records/`). The reserved `media/`, `records/`, `globals/` folders
 *   are excluded (globals legitimately stays top-level).
 * - **B** — `media/settings.json` still carries app-wide preference keys (they should have hoisted to
 *   `<root>/settings.json`; only `classOrder` may remain).
 *
 * Purely observational — never writes. A fresh/empty root reads as current (the app creates the new
 * layout directly).
 */
export function detectOldLayout(): string | null {
	const root = getRootDir();
	const reserved = new Set<string>([MEDIA_DIR_NAME, RECORDS_DIR_NAME, GLOBALS_TYPE_ID]);

	// Signal A — a record type still sitting at the top level.
	let entries: fssync.Dirent[] = [];
	try {
		entries = fssync.readdirSync(root, { withFileTypes: true });
	} catch {
		return null; // root unreadable / absent ⇒ nothing to flag
	}
	for (const ent of entries) {
		if (!ent.isDirectory() || reserved.has(ent.name)) continue;
		if (readMediaTypeSettingsFileSync(path.join(root, ent.name))) {
			return `a record type ("${ent.name}") still sits at the data-root top level (pre-Item-18 layout)`;
		}
	}

	// Signal B — app-wide prefs still in media/settings.json.
	try {
		const raw = JSON.parse(fssync.readFileSync(getMediaSettingsPath(), 'utf-8')) as Record<
			string,
			unknown
		>;
		if (APP_WIDE_SETTINGS_KEYS.some((k) => k in raw)) {
			return `media/settings.json still holds app-wide preferences (pre-Item-18 layout)`;
		}
	} catch {
		// missing / malformed ⇒ not a signal
	}

	return null;
}

/**
 * Throw a clear, actionable error if the data root predates the Item 18 reorg. The app deliberately
 * does **not** read the old layout (no dual-read), so this guard is the single place that surfaces an
 * un-migrated root instead of silently showing a broken/empty workspace. Read-only — never mutates.
 */
export function assertCurrentLayout(): void {
	const reason = detectOldLayout();
	if (!reason) return;
	const root = getRootDir();
	throw new Error(
		`Old data layout detected at ${root} — ${reason}.\n` +
			`Run:  npm run upgrade-data -- ${root} --apply\n` +
			`(then restart the server). See docs/plans/v1.0/18-records-storage-reorg.md`
	);
}
