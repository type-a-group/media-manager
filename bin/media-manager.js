#!/usr/bin/env node
import { spawn, exec } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal CLI wrapper for running the built SvelteKit node server.
 *
 * Usage:
 *   media-manager /path/to/root [--port N] [--body-size-limit N] [--no-open]
 *
 * The first positional argument is required and sets MEDIA_MANAGER_ROOT.
 * The root folder should contain one subfolder per media type (each with settings.json).
 *
 * Port (Item 31): by default the server binds an **ephemeral OS-assigned port** (no fixed 3000),
 * so it never collides with a host project's dev server. We probe a free port up-front, pass it to
 * the server, and auto-open the actually-bound URL on the server's **readiness signal** (its
 * "Listening on …" log line) rather than a fixed timer. Pass `--port N` (or export `PORT`) to pin a
 * specific port.
 *
 * By default, opens the app in the browser when the server is ready. Use --no-open to disable.
 *
 * Concerns / future improvements:
 * - Zero-config root discovery via media-manager.config.json + `serve`/`init`/`doctor` verbs (Item 30).
 * - Build-on-demand when build/ is absent (Item 30).
 * - The probe → pass-to-child handoff has a tiny TOCTOU window; the race-free alternative is to run
 *   the server in-process (import build/handler.js) and read server.address().port directly.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

let rootDir;
let bodySizeLimit;
/** Explicit port pin via --port (optional); otherwise we probe an ephemeral one. */
let portFlag;
let noOpen = false;
const passthrough = [];

for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === '--body-size-limit') {
		bodySizeLimit = argv[i + 1];
		i++;
		continue;
	}
	if (arg === '--port') {
		portFlag = argv[i + 1];
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
		'Usage: media-manager <root-dir> [--port N] [--body-size-limit N] [--no-open]\n\n' +
			'  root-dir  Path to the folder containing your media types (required)\n' +
			'            Layout: <root-dir>/<typeId>/ with settings.json per type.\n\n' +
			'  --port N    Pin a fixed port (default: an ephemeral OS-assigned port)\n' +
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

/**
 * Ask the OS for a free TCP port by binding port 0 and reading back the assigned port, then closing.
 * The bound port is passed to the child server via PORT. There is a tiny TOCTOU window between this
 * close and the child binding — acceptable for a local, single-user tool.
 *
 * @returns {Promise<number>} an available port number.
 */
function findFreePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.unref();
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function main() {
	// Port precedence: --port flag → an already-exported PORT → probe an ephemeral one.
	const boundPort = String(portFlag || env.PORT || (await findFreePort()));
	env.PORT = boundPort;
	const url = `http://localhost:${boundPort}`;

	// Pipe the child's stdout so we can detect the real readiness signal while still forwarding logs.
	const child = spawn(process.execPath, [buildPath, ...passthrough], {
		stdio: ['inherit', 'pipe', 'inherit'],
		env
	});

	let opened = false;
	const openBrowser = () => {
		if (opened || noOpen) return;
		opened = true;
		const cmd =
			process.platform === 'darwin'
				? `open "${url}"`
				: process.platform === 'win32'
					? `start "" "${url}"`
					: `xdg-open "${url}"`;
		exec(cmd, (err) => {
			if (err) console.warn('[media-manager] Could not open browser:', err.message);
		});
	};

	// adapter-node logs "Listening on http://<host>:<port>" once bound — open on that signal, not a guess.
	child.stdout.on('data', (chunk) => {
		process.stdout.write(chunk);
		if (!opened && /Listening on/i.test(chunk.toString())) openBrowser();
	});

	// Fallback: if the readiness line never appears, open anyway after a short grace period.
	const fallback = setTimeout(openBrowser, 8000);
	fallback.unref?.();

	child.on('exit', (code, signal) => {
		clearTimeout(fallback);
		if (signal) process.kill(process.pid, signal);
		process.exit(code ?? 0);
	});
}

main().catch((err) => {
	console.error('[media-manager]', err?.message || err);
	process.exit(1);
});
