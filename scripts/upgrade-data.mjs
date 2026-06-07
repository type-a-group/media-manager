#!/usr/bin/env node
/**
 * Data folder upgrade / diagnostic tool for a media-manager root (MEDIA_MANAGER_ROOT).
 *
 * Scans every media-type folder under the given root and reports (and optionally applies)
 * the upgrades the current codebase expects:
 *
 *   1. `files/` group   → must be `kind: blob_store` (legacy auto-created group was `generic`).
 *   2. `globals/` group → must be `kind: json` with exactly ONE record whose id is the canonical
 *                         globals UUID (legacy ids such as `global-settings` are migrated).
 *   3. Shared blob store → all file-backed kinds (`images`, `generic`, `blob_store`) now read their
 *                         binaries from the single global `<root>/files/` directory. Blobs still
 *                         sitting in legacy per-type locations (an images type's `files/` subdir, or a
 *                         generic type's folder root) are relocated into `<root>/files/`. Basenames are
 *                         preserved so existing catalog `file_name` references keep resolving; files
 *                         whose name already exists in the global store (with different content) are
 *                         reported as conflicts and skipped.
 *
 * Usage:
 *   node scripts/upgrade-data.mjs <root>           # dry run: report only (no writes)
 *   node scripts/upgrade-data.mjs <root> --apply   # perform the upgrades
 *   MEDIA_MANAGER_ROOT=/path node scripts/upgrade-data.mjs --apply
 *
 * Exit codes: 0 = ok (or fixes applied), 1 = pending upgrades found in dry-run, 2 = usage/IO error.
 *
 * Concerns / future improvements:
 * - This is intentionally dependency-free (plain Node) so it can run without building the app.
 * - It duplicates a couple of constants from `src/lib/storage` (kept in sync manually).
 * - Conflict resolution for relocation is conservative (skip + report); it never clobbers or
 *   silently renames, since renaming would require rewriting catalog `file_name` references.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Canonical globals singleton record id (mirrors GLOBALS_RECORD_ID in src/lib/storage/mediaTypes.ts). */
const GLOBALS_RECORD_ID = '00000000-0000-4000-8000-000000000001';
/** Folder name of the shared global blob store (mirrors GLOBAL_FILES_DIR_NAME in src/lib/storage/paths.ts). */
const GLOBAL_FILES_DIR_NAME = 'files';
/** Default per-type subfolder that legacy `images` types used for their blobs. */
const DEFAULT_FILES_SUBDIR = 'files';
/** Files that live in a type folder but are not blobs (never relocated). */
const NON_BLOB_NAMES = new Set(['settings.json', 'data.json', 'image-data.json', 'schema.json']);

/** ANSI color helpers for readable output (no-op when not a TTY). */
const useColor = process.stdout.isTTY;
const c = {
	bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
	red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
	green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
	yellow: (s) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
	cyan: (s) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
	dim: (s) => (useColor ? `\x1b[2m${s}\x1b[0m` : s)
};

/**
 * Read and parse a JSON file, returning null on missing/invalid.
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {any|null} Parsed value or null
 */
function readJsonSafe(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
	} catch {
		return null;
	}
}

/**
 * Write JSON to a file atomically (temp file + rename).
 * @param {string} filePath - Destination path
 * @param {any} value - JSON-serializable value
 */
function writeJsonAtomic(filePath, value) {
	const tmp = `${filePath}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
	fs.renameSync(tmp, filePath);
}

/**
 * Whether two files have identical content (size check first, then byte compare).
 * @param {string} a - First file path
 * @param {string} b - Second file path
 * @returns {boolean} true if both exist and are byte-identical
 */
function filesEqual(a, b) {
	try {
		const sa = fs.statSync(a);
		const sb = fs.statSync(b);
		if (sa.size !== sb.size) return false;
		return fs.readFileSync(a).equals(fs.readFileSync(b));
	} catch {
		return false;
	}
}

/**
 * List immediate files (not directories, not hidden) in a directory.
 * @param {string} dir - Directory to list
 * @returns {string[]} File basenames
 */
function listFiles(dir) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('.lock'))
		.map((e) => e.name);
}

/**
 * Read a media-type settings.json, returning its parsed form or null when it is not a media type.
 * @param {string} baseDir - Media-type folder
 * @returns {{displayName?: string, kind: string, schema?: object, dataFileName?: string, filesSubdir?: string}|null}
 */
function readSettings(baseDir) {
	const settings = readJsonSafe(path.join(baseDir, 'settings.json'));
	if (!settings || typeof settings !== 'object') return null;
	const kind = settings.kind;
	if (kind !== 'images' && kind !== 'json' && kind !== 'generic' && kind !== 'blob_store') return null;
	return settings;
}

// ---- main ----------------------------------------------------------------

const rawArgs = process.argv.slice(2);
const apply = rawArgs.includes('--apply');
const rootArg = rawArgs.find((a) => !a.startsWith('--'));
const root = path.resolve(rootArg || process.env.MEDIA_MANAGER_ROOT || '');

if (!rootArg && !process.env.MEDIA_MANAGER_ROOT) {
	console.error(c.red('Error: no data root given.'));
	console.error('Usage: node scripts/upgrade-data.mjs <root> [--apply]');
	console.error('   or: MEDIA_MANAGER_ROOT=/path node scripts/upgrade-data.mjs [--apply]');
	process.exit(2);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
	console.error(c.red(`Error: root is not a directory: ${root}`));
	process.exit(2);
}

console.log(c.bold(`\nmedia-manager data upgrade — ${apply ? c.yellow('APPLY mode') : c.cyan('dry run (report only)')}`));
console.log(c.dim(`root: ${root}\n`));

const globalFilesDir = path.join(root, GLOBAL_FILES_DIR_NAME);

/** Accumulated planned/performed actions, grouped for the summary. */
const planned = [];
/** Conflicts (need manual attention), never auto-resolved. */
const conflicts = [];
/** Informational notes. */
const notes = [];

/** Record a planned action. @param {string} msg @param {() => void} [fix] */
function plan(msg, fix) {
	planned.push({ msg, fix });
}

// Discover media-type folders.
const typeDirs = fs
	.readdirSync(root, { withFileTypes: true })
	.filter((e) => e.isDirectory())
	.map((e) => e.name)
	.filter((name) => readSettings(path.join(root, name)) !== null)
	.sort();

console.log(c.bold('Discovered media types:'));
for (const id of typeDirs) {
	const s = readSettings(path.join(root, id));
	console.log(`  ${c.cyan(id.padEnd(20))} ${c.dim(s.kind)}`);
}
console.log('');

// --- Check 1: files/ group must be blob_store ---
{
	const baseDir = path.join(root, GLOBAL_FILES_DIR_NAME);
	const s = readSettings(baseDir);
	if (!s) {
		notes.push(`No "${GLOBAL_FILES_DIR_NAME}" group yet — it is auto-created as blob_store on first app load.`);
	} else if (s.kind === 'generic' || s.kind === 'images') {
		plan(`Upgrade "${GLOBAL_FILES_DIR_NAME}" group: kind ${s.kind} → blob_store`, () => {
			const next = { ...s, kind: 'blob_store', displayName: s.displayName ?? 'Files', schema: {} };
			// blob_store does not use a per-type files subdir.
			delete next.filesSubdir;
			writeJsonAtomic(path.join(baseDir, 'settings.json'), next);
		});
	} else if (s.kind !== 'blob_store') {
		conflicts.push(`"${GLOBAL_FILES_DIR_NAME}" group has unexpected kind "${s.kind}" (expected blob_store).`);
	}
}

// --- Check 2: globals/ group heal ---
{
	const baseDir = path.join(root, 'globals');
	const settingsPath = path.join(baseDir, 'settings.json');
	const dataPath = path.join(baseDir, 'data.json');
	const s = readSettings(baseDir);
	if (!s) {
		notes.push('No "globals" group yet — it is auto-created/healed when the app loads it.');
	} else {
		if (s.kind !== 'json') {
			plan(`Fix "globals" group kind: ${s.kind} → json`, () => {
				writeJsonAtomic(settingsPath, { ...s, kind: 'json', displayName: s.displayName ?? 'Globals', schema: {} });
			});
		}
		const data = readJsonSafe(dataPath);
		const records = data && Array.isArray(data.records) ? data.records : [];
		const canonical =
			records.find((r) => r && typeof r === 'object' && r.id === GLOBALS_RECORD_ID) ??
			(records[0] && typeof records[0] === 'object' ? records[0] : null);
		const needsHeal =
			records.length !== 1 || !records[0] || records[0].id !== GLOBALS_RECORD_ID;
		if (needsHeal) {
			const legacyId = canonical && canonical.id && canonical.id !== GLOBALS_RECORD_ID ? canonical.id : null;
			const detail =
				records.length === 0
					? 'create singleton record'
					: records.length > 1
						? `collapse ${records.length} records → 1 singleton`
						: legacyId
							? `migrate record id "${legacyId}" → canonical UUID`
							: 'normalize singleton record id';
			plan(`Heal "globals" data: ${detail}`, () => {
				const healed = {
					...(canonical ?? {}),
					id: GLOBALS_RECORD_ID,
					name:
						canonical && typeof canonical.name === 'string' && canonical.name.trim()
							? canonical.name
							: 'Global Settings'
				};
				writeJsonAtomic(dataPath, { records: [healed] });
			});
		}
	}
}

// --- Check 3: relocate blobs into the shared global files/ dir ---
/**
 * Plan relocation of one blob into the global files store.
 * @param {string} typeId - Owning media type (for messages)
 * @param {string} srcPath - Current absolute file path
 * @param {string} name - Basename (preserved at destination)
 */
function planRelocate(typeId, srcPath, name) {
	const destPath = path.join(globalFilesDir, name);
	if (fs.existsSync(destPath)) {
		if (filesEqual(srcPath, destPath)) {
			plan(`[${typeId}] duplicate blob already in files/: remove ${c.dim(srcPath)}`, () => {
				fs.rmSync(srcPath);
			});
		} else {
			conflicts.push(
				`[${typeId}] "${name}" exists in files/ with different content — left in place: ${srcPath}`
			);
		}
		return;
	}
	plan(`[${typeId}] move blob → files/${name} ${c.dim(`(from ${srcPath})`)}`, () => {
		fs.mkdirSync(globalFilesDir, { recursive: true });
		try {
			fs.renameSync(srcPath, destPath);
		} catch {
			// Cross-device fallback: copy then unlink.
			fs.copyFileSync(srcPath, destPath);
			fs.rmSync(srcPath);
		}
	});
}

for (const id of typeDirs) {
	const baseDir = path.join(root, id);
	const s = readSettings(baseDir);
	if (!s) continue;

	if (id === GLOBAL_FILES_DIR_NAME) {
		// The blob store itself: its root files are already in the destination. But a legacy
		// images-kind files group may have stored blobs in a nested <files>/<filesSubdir>/ dir —
		// pull those up into <root>/files/.
		if (s.kind === 'images') {
			const subdir = path.join(baseDir, s.filesSubdir || DEFAULT_FILES_SUBDIR);
			if (fs.existsSync(subdir) && path.resolve(subdir) !== path.resolve(globalFilesDir)) {
				for (const name of listFiles(subdir)) planRelocate(id, path.join(subdir, name), name);
				plan(`[${id}] remove empty legacy files subdir ${c.dim(subdir)}`, () => {
					try {
						if (fs.readdirSync(subdir).length === 0) fs.rmdirSync(subdir);
					} catch {
						/* ignore */
					}
				});
			}
		}
		continue;
	}

	if (s.kind === 'images') {
		// Legacy images stored blobs in <type>/<filesSubdir>/.
		const subdir = path.join(baseDir, s.filesSubdir || DEFAULT_FILES_SUBDIR);
		if (fs.existsSync(subdir) && subdir !== globalFilesDir) {
			for (const name of listFiles(subdir)) planRelocate(id, path.join(subdir, name), name);
			// Remove the now-empty legacy subdir on apply.
			plan(`[${id}] remove empty legacy files subdir ${c.dim(subdir)}`, () => {
				try {
					if (fs.readdirSync(subdir).length === 0) fs.rmdirSync(subdir);
				} catch {
					/* ignore */
				}
			});
		}
	} else if (s.kind === 'generic') {
		// Legacy generic stored blobs in the type folder root.
		for (const name of listFiles(baseDir)) {
			if (NON_BLOB_NAMES.has(name)) continue;
			planRelocate(id, path.join(baseDir, name), name);
		}
	}
}

// --- Report ---
console.log(c.bold('Pending upgrades:'));
if (planned.length === 0) {
	console.log(`  ${c.green('none — your setup is up to date.')}`);
} else {
	for (const a of planned) console.log(`  ${c.yellow('•')} ${a.msg}`);
}

if (conflicts.length > 0) {
	console.log(c.bold('\nConflicts (need manual attention, not auto-fixed):'));
	for (const m of conflicts) console.log(`  ${c.red('✗')} ${m}`);
}

if (notes.length > 0) {
	console.log(c.bold('\nNotes:'));
	for (const m of notes) console.log(`  ${c.dim('i')} ${c.dim(m)}`);
}

console.log('');

if (apply && planned.length > 0) {
	console.log(c.bold('Applying upgrades...'));
	let done = 0;
	for (const a of planned) {
		try {
			if (a.fix) {
				a.fix();
				done++;
			}
		} catch (err) {
			console.log(`  ${c.red('✗')} failed: ${a.msg}\n    ${err?.message ?? err}`);
		}
	}
	console.log(`  ${c.green(`applied ${done}/${planned.length} upgrade(s).`)}`);
	if (conflicts.length > 0) console.log(c.yellow(`  ${conflicts.length} conflict(s) still need manual attention.`));
	console.log('');
	process.exit(0);
}

if (planned.length > 0) {
	console.log(c.dim(`Re-run with ${c.bold('--apply')} to perform the ${planned.length} upgrade(s) above.\n`));
	process.exit(1);
}

process.exit(0);
