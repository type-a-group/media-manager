#!/usr/bin/env node
import { spawn, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal CLI wrapper for running the built SvelteKit node server.
 *
 * Usage:
 *   media-manager /path/to/root [--body-size-limit N] [--no-open]
 *
 * The first positional argument is required and sets MEDIA_MANAGER_ROOT.
 * The root folder should contain one subfolder per media type (each with settings.json).
 *
 * By default, opens the app in the browser when the server is ready.
 * Use --no-open to disable.
 *
 * Concerns / future improvements:
 * - Add `--port`/`--host` flags (wired to `PORT`/`HOST` env vars).
 * - Add config file support (e.g. `.media-managerrc`).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

let rootDir;
let bodySizeLimit;
let noOpen = false;
const passthrough = [];

for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === '--body-size-limit') {
		bodySizeLimit = argv[i + 1];
		i++;
		continue;
	}
	if (arg === '--no-open') {
		noOpen = true;
		continue;
	}
	if (arg.startsWith('--')) {
		passthrough.push(arg);
		continue;
	}
	// First non-flag arg is the root dir
	if (!rootDir) {
		rootDir = arg;
	} else {
		passthrough.push(arg);
	}
}

if (!rootDir) {
	console.error(
		'Usage: media-manager <root-dir> [--body-size-limit N] [--no-open]\n\n' +
			'  root-dir  Path to the folder containing your media types (required)\n' +
			'            Layout: <root-dir>/<typeId>/ with settings.json per type.\n\n' +
			'  --no-open   Do not open the app in the browser automatically\n\n' +
			'Example:\n' +
			'  media-manager ./my-data'
	);
	process.exit(1);
}

const buildPath = path.join(pkgRoot, 'build');
if (!fs.existsSync(buildPath)) {
	console.error(
		`Build output not found at "${buildPath}".\n\n` +
			`Run "npm run build" in this package before using the CLI.`
	);
	process.exit(1);
}

const env = { ...process.env };
env.MEDIA_MANAGER_ROOT = path.resolve(rootDir);

// Default port for SvelteKit adapter-node (used for auto-open URL).
if (!env.PORT) env.PORT = '3000';

// Increase the default request body size limit for uploads when running via this CLI.
if (bodySizeLimit) {
	env.BODY_SIZE_LIMIT = bodySizeLimit;
} else if (!env.BODY_SIZE_LIMIT) {
	const defaultLimitBytes = 100 * 1024 * 1024;
	env.BODY_SIZE_LIMIT = String(defaultLimitBytes);
	console.warn(
		[
			'[media-manager] BODY_SIZE_LIMIT was not set;',
			`defaulting to ${defaultLimitBytes} bytes (~100 MiB) for uploads.`,
			'This is intended for local use only. If you expose this server publicly,',
			'please set a smaller BODY_SIZE_LIMIT or run behind a reverse proxy with its',
			'own upload limits.'
		].join(' ')
	);
}

const child = spawn(process.execPath, [buildPath, ...passthrough], {
	stdio: 'inherit',
	env
});

// Auto-open browser when server is ready (unless --no-open).
if (!noOpen) {
	const port = env.PORT || '3000';
	const url = `http://localhost:${port}`;
	// Give the server a moment to bind before opening.
	setTimeout(() => {
		const cmd =
			process.platform === 'darwin'
				? `open "${url}"`
				: process.platform === 'win32'
					? `start "" "${url}"`
					: `xdg-open "${url}"`;
		exec(cmd, (err) => {
			if (err) console.warn('[media-manager] Could not open browser:', err.message);
		});
	}, 2000);
}

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	process.exit(code ?? 0);
});
