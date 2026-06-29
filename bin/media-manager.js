#!/usr/bin/env node
import { spawn, spawnSync, exec } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CLI for running media-manager against a data root.
 *
 * Usage:
 *   media-manager [serve] [root] [--port N] [--body-size-limit N] [--no-open] [--rebuild]
 *   media-manager init [dir]            scaffold a new empty workspace + config
 *   media-manager config [dir]          write a config for a workspace you already have (--force to overwrite)
 *   media-manager build                 (re)build build/ and exit, without serving
 *   media-manager doctor
 *
 * Root discovery (Item 30) — precedence:
 *   1. explicit positional arg
 *   2. MEDIA_MANAGER_ROOT env
 *   3. media-manager.config.json (walked up from cwd; `root` resolved relative to the config file)
 *   4. friendly error (see `doctor`)
 *
 * Port (Item 31): binds an ephemeral OS-assigned port by default (no fixed 3000) so it never collides
 * with a host project's dev server; auto-opens the actually-bound URL on the server's readiness signal.
 * Pass `--port N` (or export `PORT`) to pin.
 *
 * Build (Item 30): if `build/` is absent it is built on demand; `--rebuild` forces a fresh build.
 * When this package is published, `build/` ships in the tarball, so consumers never build — the
 * on-demand path only fires in a git-clone / local-dep checkout.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const buildPath = path.join(pkgRoot, 'build');
const CONFIG_NAME = 'media-manager.config.json';
const VERBS = new Set(['serve', 'init', 'doctor', 'config', 'build']);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

let verb = 'serve';
let sawVerb = false;
let rootArg;
let bodySizeLimit;
/** Explicit port pin via --port (optional); otherwise we probe an ephemeral one. */
let portFlag;
let noOpen = false;
let rebuild = false;
let force = false;
const passthrough = [];

for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === '--help' || arg === '-h' || arg === 'help') {
		printHelp();
		process.exit(0);
	}
	if (arg === '--body-size-limit') {
		bodySizeLimit = argv[++i];
		continue;
	}
	if (arg === '--port') {
		portFlag = argv[++i];
		continue;
	}
	if (arg === '--no-open') {
		noOpen = true;
		continue;
	}
	if (arg === '--rebuild') {
		rebuild = true;
		continue;
	}
	if (arg === '--force') {
		force = true;
		continue;
	}
	if (arg.startsWith('--')) {
		passthrough.push(arg);
		continue;
	}
	// Positionals: an optional leading verb, then the root dir.
	if (!sawVerb && !rootArg && VERBS.has(arg)) {
		verb = arg;
		sawVerb = true;
		continue;
	}
	if (!rootArg) {
		rootArg = arg;
	} else {
		passthrough.push(arg);
	}
}

// ---------------------------------------------------------------------------
// Root discovery
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` to the nearest `media-manager.config.json`, returning its absolute path or
 * null if none exists up to the filesystem root.
 *
 * @param {string} startDir - Directory to begin the upward search from.
 * @returns {string | null}
 */
function findConfig(startDir) {
	let dir = path.resolve(startDir);
	for (;;) {
		const candidate = path.join(dir, CONFIG_NAME);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Load + validate a `media-manager.config.json`. `root` is resolved **relative to the config file's
 * directory** (not cwd), so running from a subdirectory still finds the right data.
 *
 * @param {string} startDir - Where to begin the upward search.
 * @returns {{ configPath: string, root: string } | null}
 * @throws If the config is present but malformed (bad JSON or missing/empty `root`).
 */
function loadConfig(startDir) {
	const configPath = findConfig(startDir);
	if (!configPath) return null;
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
	} catch (e) {
		throw new Error(`Invalid JSON in ${configPath}: ${e.message}`);
	}
	if (!parsed || typeof parsed.root !== 'string' || parsed.root.trim() === '') {
		throw new Error(`${configPath} must set a non-empty "root" string.`);
	}
	return { configPath, root: path.resolve(path.dirname(configPath), parsed.root) };
}

/**
 * Resolve the data root by the documented precedence: arg → env → config file → null.
 *
 * @param {string | undefined} explicitArg - A positional root path, if given.
 * @returns {{ root: string, source: 'arg' | 'env' | 'config', configPath?: string } | null}
 */
function resolveRoot(explicitArg) {
	if (explicitArg) return { root: path.resolve(explicitArg), source: 'arg' };
	if (process.env.MEDIA_MANAGER_ROOT) {
		return { root: path.resolve(process.env.MEDIA_MANAGER_ROOT), source: 'env' };
	}
	const cfg = loadConfig(process.cwd());
	if (cfg) return { root: cfg.root, source: 'config', configPath: cfg.configPath };
	return null;
}

/** Print CLI usage (for `--help` / `-h` / `help`). */
function printHelp() {
	console.log(
		`media-manager — local-first media metadata manager

Usage:
  media-manager [serve] [root] [options]   Run the app (default verb)
  media-manager init [dir]                 Scaffold a NEW empty workspace + config
  media-manager config [dir]               Write a config for a workspace you ALREADY have
  media-manager build                      (Re)build build/ and exit, without serving
  media-manager doctor                     Diagnose root / config / build (no server)

Root resolution (serve · doctor):
  explicit arg → MEDIA_MANAGER_ROOT env → ${CONFIG_NAME} (walked up from cwd) → friendly error

Options:
  --port N             Pin a fixed port (default: an ephemeral OS-assigned port)
  --no-open            Do not open the browser on start
  --rebuild            Force a fresh build even if build/ already exists
  --force              (init · config) overwrite an existing ${CONFIG_NAME}
  --body-size-limit N  Upload request body size limit in bytes (default ~100 MiB)
  -h, --help           Show this help

Examples:
  media-manager ./my-data            Serve a folder directly
  media-manager config ./src/assets/media_manager   Write a config for existing data, then:
  media-manager                      Serve via the discovered config (ephemeral port, auto-open)`
	);
}

/** Print the shared "no workspace found" guidance (used by serve + doctor). */
function printNoRoot() {
	console.error(
		'✘ Could not find a workspace.\n' +
			'  Tried: no path arg · MEDIA_MANAGER_ROOT unset · no ' +
			CONFIG_NAME +
			' found\n' +
			`  (searched ${process.cwd()} upward)\n\n` +
			'  Fix one of:\n' +
			'    • run  media-manager ./path/to/data\n' +
			`    • drop a ${CONFIG_NAME} with { "root": "…" }\n` +
			'    • run  media-manager init  to scaffold a fresh workspace'
	);
}

// ---------------------------------------------------------------------------
// Build-on-demand
// ---------------------------------------------------------------------------

/**
 * Ensure the SvelteKit node build exists, building it once on demand when absent (or always when
 * `--rebuild`). Exits the process on build failure.
 *
 * @param {boolean} force - Rebuild even if `build/` already exists.
 */
function ensureBuilt(force) {
	const exists = fs.existsSync(buildPath);
	if (exists && !force) return;
	console.log(
		force ? '[media-manager] building…' : '[media-manager] build/ not found — building once…'
	);
	const res = spawnSync(npmCmd, ['run', 'build'], {
		cwd: pkgRoot,
		stdio: 'inherit',
		shell: process.platform === 'win32'
	});
	if (res.status !== 0) {
		console.error('[media-manager] Build failed.');
		process.exit(res.status ?? 1);
	}
}

// ---------------------------------------------------------------------------
// Port helpers (Item 31)
// ---------------------------------------------------------------------------

/**
 * Ask the OS for a free TCP port by binding port 0 and reading back the assigned port, then closing.
 * There is a tiny TOCTOU window between this close and the child binding — acceptable for a local,
 * single-user tool.
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

/** Open a URL in the default browser (best-effort, cross-platform). */
function openUrl(url) {
	const cmd =
		process.platform === 'darwin'
			? `open "${url}"`
			: process.platform === 'win32'
				? `start "" "${url}"`
				: `xdg-open "${url}"`;
	exec(cmd, (err) => {
		if (err) console.warn('[media-manager] Could not open browser:', err.message);
	});
}

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

/** `serve` (default): resolve root, build if needed, bind an ephemeral port, open on readiness. */
async function serve() {
	const resolved = resolveRoot(rootArg);
	if (!resolved) {
		printNoRoot();
		process.exit(1);
	}
	if (!fs.existsSync(resolved.root)) {
		console.error(`✘ Root does not exist: ${resolved.root} (from ${resolved.source})`);
		process.exit(1);
	}

	ensureBuilt(rebuild);

	const env = { ...process.env };
	env.MEDIA_MANAGER_ROOT = resolved.root;

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
	const openOnce = () => {
		if (opened || noOpen) return;
		opened = true;
		openUrl(url);
	};

	// adapter-node logs "Listening on http://<host>:<port>" once bound — open on that signal, not a guess.
	child.stdout.on('data', (chunk) => {
		process.stdout.write(chunk);
		if (!opened && /Listening on/i.test(chunk.toString())) openOnce();
	});

	// Fallback: if the readiness line never appears, open anyway after a short grace period.
	const fallback = setTimeout(openOnce, 8000);
	fallback.unref?.();

	child.on('exit', (code, signal) => {
		clearTimeout(fallback);
		if (signal) process.kill(process.pid, signal);
		process.exit(code ?? 0);
	});
}

/**
 * Write `media-manager.config.json` in the current directory pointing at `target`. Leaves an existing
 * config untouched unless `force`. `root` is stored **relative to cwd** (POSIX-style, `./`-prefixed)
 * so it stays portable.
 *
 * @param {string} target - Absolute path to the workspace the config should point at.
 * @param {boolean} overwrite - Overwrite an existing config.
 * @returns {{ configPath: string, root: string, wrote: boolean }}
 */
function writeConfigFile(target, overwrite) {
	const configPath = path.join(process.cwd(), CONFIG_NAME);
	const rel = path.relative(process.cwd(), target) || '.';
	const relPosix = rel.split(path.sep).join('/');
	const root = relPosix.startsWith('.') ? relPosix : `./${relPosix}`;
	if (fs.existsSync(configPath) && !overwrite) return { configPath, root, wrote: false };
	fs.writeFileSync(configPath, JSON.stringify({ root }, null, 2) + '\n');
	return { configPath, root, wrote: true };
}

/** Does `dir` look like an already-initialized media-manager workspace? */
function looksLikeWorkspace(dir) {
	return (
		fs.existsSync(path.join(dir, 'media')) ||
		fs.existsSync(path.join(dir, 'globals')) ||
		fs.existsSync(path.join(dir, 'records'))
	);
}

/**
 * `init [dir]`: scaffold an **empty** workspace directory and a config pointing at it. The app's own
 * first-launch healing fills in `media/` etc. on the first `serve`. To point at a workspace you
 * **already have** (without scaffolding), use `config` instead.
 */
function init() {
	const target = path.resolve(rootArg || './media_manager');
	fs.mkdirSync(target, { recursive: true });

	const { configPath, wrote } = writeConfigFile(target, force);
	console.log(`✔ workspace   ${target}`);
	console.log(
		wrote
			? `✔ config      ${configPath}`
			: `· config      ${configPath} already exists, left as-is`
	);
	console.log(
		'\nNext: run  media-manager  to start (it will build + heal the workspace on first launch).'
	);
}

/**
 * `config [dir]`: generate a `media-manager.config.json` (in cwd) pointing at a workspace you
 * **already have** (`dir`, default cwd). Unlike `init` it never scaffolds; it refuses to clobber an
 * existing config unless `--force`.
 */
function config() {
	const target = path.resolve(rootArg || '.');
	if (!fs.existsSync(target)) {
		console.error(
			`✘ ${target} does not exist. Pass an existing workspace dir, or use \`init\` to scaffold one.`
		);
		process.exit(1);
	}

	const { configPath, root, wrote } = writeConfigFile(target, force);
	if (!wrote) {
		console.error(`✘ ${configPath} already exists. Re-run with --force to overwrite.`);
		process.exit(1);
	}

	console.log(`✔ config      ${configPath}  → root: ${root}`);
	if (!looksLikeWorkspace(target)) {
		console.log(
			`· note: ${target} has no media/ · globals/ · records/ yet — it'll be healed on first serve.`
		);
	}
	console.log('\nNext: run  media-manager  to start.');
}

/** `doctor`: diagnose root/config/build without starting the server. */
function doctor() {
	let resolved = null;
	try {
		resolved = resolveRoot(rootArg);
	} catch (e) {
		console.error(`✘ config      ${e.message}`);
		process.exit(1);
	}

	if (!resolved) {
		printNoRoot();
		process.exit(1);
	}

	const tick = (ok) => (ok ? '✔' : '✘');
	if (resolved.source === 'config') console.log(`✔ config      ${resolved.configPath}`);
	else console.log(`· config      (using ${resolved.source}; no ${CONFIG_NAME} consulted)`);

	const rootExists = fs.existsSync(resolved.root);
	let writable = false;
	try {
		fs.accessSync(resolved.root, fs.constants.W_OK);
		writable = true;
	} catch {
		writable = false;
	}
	console.log(
		`${tick(rootExists)} root        ${resolved.root}` +
			(rootExists ? ` (${writable ? 'writable' : 'NOT writable'})` : ' (does not exist — run init)')
	);

	if (rootExists) {
		const hasHub = fs.existsSync(path.join(resolved.root, 'media'));
		console.log(
			`${hasHub ? '✔' : '·'} workspace   ${hasHub ? 'media/ hub present' : 'empty — will heal on first serve'}`
		);
	}

	const built = fs.existsSync(buildPath);
	console.log(
		`${built ? '✔' : '!'} build       ${built ? 'present' : 'missing — will build on first serve (or --rebuild)'}`
	);
	console.log('✔ port        ephemeral (OS-assigned; pin with --port N)');

	process.exit(rootExists ? 0 : 1);
}

/** `build`: (re)build the Node server (`build/`) and exit, without starting the server. */
function build() {
	ensureBuilt(true);
	console.log('✔ build complete.');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function main() {
	if (verb === 'init') return init();
	if (verb === 'config') return config();
	if (verb === 'doctor') return doctor();
	if (verb === 'build') return build();
	return serve();
}

main().catch((err) => {
	console.error('[media-manager]', err?.message || err);
	process.exit(1);
});
