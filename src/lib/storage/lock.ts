import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';

/**
 * Acquire a coarse-grained file lock using a sibling `.lock` file.
 *
 * Use case:
 * - Prevent concurrent requests from corrupting `image-data.json` / `schema.json`.
 * - Good enough for dev and a single-node deployment.
 *
 * @param lockPath - Path to the lock file (e.g. `${imageDataPath}.lock`)
 * @param fn - Critical section
 *
 * Concerns / future improvements:
 * - This is not a distributed lock. For multi-process/multi-node setups, use a real lock service.
 * - We retry with a basic backoff; for high contention, add jitter and observability.
 */
export async function withFileLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
	const maxAttempts = 40;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const handle = await fs.open(lockPath, 'wx');
			try {
				return await fn();
			} finally {
				await handle.close();
				await fs.unlink(lockPath).catch(() => {});
			}
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			// Handle lock-file already exists
			if (e.code === 'EEXIST') {
				// If the lock file looks stale (older than TTL), remove it and retry immediately.
				try {
					const stat = fssync.statSync(lockPath);
					const ageMs = Date.now() - stat.mtimeMs;
					const staleTtlMs = 10_000;
					if (ageMs > staleTtlMs) {
						fssync.unlinkSync(lockPath);
						// Retry without counting against attempts.
						attempt--;
						continue;
					}
				} catch {
					// If stat/unlink fails, fall through to backoff.
				}
				if (attempt === maxAttempts - 1) throw err;
				await new Promise((r) => setTimeout(r, 10 + attempt * 5));
				continue;
			}
			// Unknown error – fail fast.
			throw err;
		}
	}
	// Unreachable, but keeps TS happy.
	throw new Error('Failed to acquire file lock');
}

