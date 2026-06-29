import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Playwright-based UI capture helper for manually testing the running app.
 *
 * Why this exists:
 *   The Claude-in-Chrome browser extension only returns screenshots *inline* to the
 *   conversation — `save_to_disk` does not persist a file this environment can reach, and
 *   the app keeps UI state out of the URL (selection/filters/open-editor aren't routable),
 *   so a one-shot headless URL capture can't reproduce mid-interaction states. Playwright
 *   drives the app and captures **any** state in the same session, writing real files to a
 *   path we control so a dev can open them.
 *
 * Two kinds of artifact, both landing in `.screenshots/` (gitignored):
 * - **Screenshots** (PNG) via `shoot(name)` — for static states / end results. Returns the
 *   absolute path immediately.
 * - **Video** (WebM) via `launchUi({ video: true })` — for multi-step or animated flows. The
 *   file is only finalized on `close()`, which renames it to a meaningful name and returns
 *   its absolute path (also pushed onto `videos`).
 *
 * Browser: defaults to Playwright's bundled chromium (`npx playwright install chromium`).
 * Set `PW_CHANNEL=chrome` to reuse the system `google-chrome-stable` instead (no download).
 *
 * Concerns / future improvements:
 * - WebM is broadly playable (browsers, VLC); convert to GIF with ffmpeg if a GIF is required.
 * - `BASE_URL` assumes the `test:serve` default port (3000); override with `UI_BASE_URL`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path to the gitignored folder where captures (PNG + WebM) are written. */
export const SCREENSHOT_DIR = path.join(repoRoot, '.screenshots');

/** Base URL the page is scoped to; matches the `npm run test:serve` default. */
export const BASE_URL = process.env.UI_BASE_URL ?? 'http://localhost:3000';

/** Timestamp + slug → a stable, sortable filename stem under SCREENSHOT_DIR. */
function captureName(name, fallback) {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const slug =
		String(name ?? '')
			.replace(/[^a-zA-Z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.toLowerCase() || fallback;
	return `${stamp}-${slug}`;
}

/**
 * Launch a headless browser scoped to the running app and return drivers + capture helpers.
 *
 * Use case:
 * - Called by a short throwaway capture script (see the `test-ui-feature` skill) that navigates,
 *   interacts, and either `shoot(name)`s key states (screenshots) and/or records the whole run
 *   as a video (`video: true`).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true] - Run headless; set false only for live local debugging.
 * @param {{width:number,height:number}} [opts.viewport] - Viewport / video size (default 1440x900).
 * @param {boolean} [opts.video=false] - Record the session to a WebM (finalized on `close()`).
 * @param {string} [opts.videoName='recording'] - Slug used for the saved video filename.
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page, errors: string[], shots: string[], videos: string[], shoot: (name: string, o?: { fullPage?: boolean }) => Promise<string>, close: () => Promise<string|undefined> }>}
 *   `errors` accumulates console errors + page exceptions; `shots`/`videos` collect saved paths.
 *   `close()` returns the saved video path when `video` was enabled, else `undefined`.
 */
export async function launchUi({
	headless = true,
	viewport = { width: 1440, height: 900 },
	video = false,
	videoName = 'recording'
} = {}) {
	const browser = await chromium.launch({ headless, channel: process.env.PW_CHANNEL || undefined });

	const contextOpts = { viewport, baseURL: BASE_URL };
	if (video) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
		// Playwright writes a hash-named WebM here on context close; we rename it afterwards.
		contextOpts.recordVideo = { dir: SCREENSHOT_DIR, size: viewport };
	}
	const context = await browser.newContext(contextOpts);
	const page = await context.newPage();

	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));

	const shots = [];
	const videos = [];

	/**
	 * Screenshot the current page state to `.screenshots/<timestamp>-<slug>.png`.
	 * @param {string} name - Human label for the state (slugified into the filename).
	 * @param {object} [o]
	 * @param {boolean} [o.fullPage=false] - Capture the full scrollable page.
	 * @returns {Promise<string>} Absolute path to the saved PNG.
	 */
	async function shoot(name, { fullPage = false } = {}) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
		const file = path.join(SCREENSHOT_DIR, `${captureName(name, 'shot')}.png`);
		await page.screenshot({ path: file, fullPage });
		shots.push(file);
		console.log(`[shot] ${file}`);
		return file;
	}

	/**
	 * Close the browser and finalize the video (if recording). Always call in a `finally` block
	 * so a failed assertion can't leak the browser or lose the recording.
	 * @returns {Promise<string|undefined>} Absolute path to the saved WebM when `video` was on.
	 */
	async function close() {
		let videoPath;
		const vid = video ? page.video() : null;
		// Closing the context flushes the recording to disk; then its path() resolves.
		await context.close();
		if (vid) {
			const raw = await vid.path();
			videoPath = path.join(SCREENSHOT_DIR, `${captureName(videoName, 'recording')}.webm`);
			fs.renameSync(raw, videoPath);
			videos.push(videoPath);
			console.log(`[video] ${videoPath}`);
		}
		await browser.close();
		return videoPath;
	}

	return { browser, context, page, errors, shots, videos, shoot, close };
}
