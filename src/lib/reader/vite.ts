/**
 * `media-manager/reader/vite` — the build-time / static consumption entry point.
 *
 * Identical surface to `media-manager/reader`; this alias exists to document intent at the import
 * site (a host using Vite's `import.meta.glob` to bundle a workspace). `MediaManager.load()` takes
 * the two glob maps directly — see {@link MediaManager.load}.
 *
 * @example
 * import { MediaManager } from 'media-manager/reader/vite';
 * const mm = MediaManager.load({
 *   data:  import.meta.glob('$assets/media_manager/**\/*.json', { eager: true, import: 'default' }),
 *   files: import.meta.glob('$assets/media_manager/media/files/*', { eager: true, query: '?url', import: 'default' }),
 * });
 */

export * from './index.js';
