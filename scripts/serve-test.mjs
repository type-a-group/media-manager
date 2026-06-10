#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serve the built app against a throwaway copy of the in-repo test fixture.
 *
 * Why this exists:
 *   Nothing in media-manager works without a data root, and **running the app
 *   mutates that root** (it heals settings.json, writes data files, and can
 *   rename/strip blob references). To keep a clean, reproducible sample dataset
 *   in the repo without git churn, we commit a pristine seed at `test-fixtures/`
 *   and serve a disposable copy of it at `test-data/` (gitignored). Every run
 *   starts from a fresh copy, so the committed seed is never touched.
 *
 * What it does:
 *   1. Builds the app (`npm run build`) if `build/` is missing.
 *   2. Refreshes `test-data/` from `test-fixtures/` (delete + recursive copy).
 *   3. Runs the CLI (`bin/media-manager.js test-data`), forwarding any extra
 *      args (e.g. `--no-open`, `--body-size-limit N`).
 *
 * Usage:
 *   npm run test:serve
 *   npm run test:serve -- --no-open
 *
 * Concerns / future improvements:
 *   - Add a `--keep` flag to reuse an existing `test-data/` working copy instead
 *     of wiping it (useful when iterating on mutations between runs).
 *   - Add a `--rebuild` flag to force `npm run build` even when `build/` exists.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const buildDir = path.join(repoRoot, 'build');
const fixturesDir = path.join(repoRoot, 'test-fixtures');
const workingDir = path.join(repoRoot, 'test-data');

if (!fs.existsSync(fixturesDir)) {
	console.error(
		`Test fixtures not found at "${fixturesDir}".\n` +
			'Expected a committed seed data root with one subfolder per media type.'
	);
	process.exit(1);
}

// 1. Build if needed (the CLI requires build/ to exist).
if (!fs.existsSync(buildDir)) {
	console.log('[serve-test] build/ not found — running "npm run build"...');
	const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const built = spawnSync(npmCmd, ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
	if (built.status !== 0) {
		console.error('[serve-test] Build failed; aborting.');
		process.exit(built.status ?? 1);
	}
}

// 2. Refresh the disposable working copy from the pristine seed.
fs.rmSync(workingDir, { recursive: true, force: true });
fs.cpSync(fixturesDir, workingDir, { recursive: true });
console.log(`[serve-test] Copied test-fixtures/ -> test-data/ (fresh working copy).`);

// 3. Serve it via the CLI, forwarding any extra args.
const passthrough = process.argv.slice(2);
const child = spawn(
	process.execPath,
	[path.join(repoRoot, 'bin', 'media-manager.js'), workingDir, ...passthrough],
	{
		cwd: repoRoot,
		stdio: 'inherit'
	}
);

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
