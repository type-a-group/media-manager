#!/usr/bin/env node
/**
 * Migration script: single-folder layout → root/images/ (multi-media-type layout).
 *
 * Usage:
 *   node scripts/migrate-to-media-types.mjs <old-folder> <root-folder>
 *
 * Example:
 *   node scripts/migrate-to-media-types.mjs ./my-images ./my-data
 *
 * What it does:
 * - Reads settings.json and schema.json from <old-folder>
 * - Creates <root-folder>/images/ with:
 *   - settings.json (merged: displayName "Images", kind "images", schema from schema.json, dataFileName, filesSubdir "files")
 *   - image-data.json (copy from old folder)
 *   - files/ (copy of old folder's images/)
 * - Does not delete or modify the old folder.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const oldDir = process.argv[2];
const rootDir = process.argv[3];

if (!oldDir || !rootDir) {
	console.error('Usage: node scripts/migrate-to-media-types.mjs <old-folder> <root-folder>');
	console.error('Example: node scripts/migrate-to-media-types.mjs ./my-images ./my-data');
	process.exit(1);
}

const oldPath = path.resolve(oldDir);
const rootPath = path.resolve(rootDir);

async function main() {
	const oldSettingsPath = path.join(oldPath, 'settings.json');
	const oldSchemaPath = path.join(oldPath, 'schema.json');
	const oldDataPath = path.join(oldPath, 'image-data.json');
	const oldImagesDir = path.join(oldPath, 'images');

	let settings = {};
	try {
		const raw = await fs.readFile(oldSettingsPath, 'utf-8');
		settings = JSON.parse(raw);
	} catch (e) {
		console.error('Could not read settings.json from old folder:', e.message);
		process.exit(1);
	}

	let schema = {};
	try {
		const raw = await fs.readFile(oldSchemaPath, 'utf-8');
		const parsed = JSON.parse(raw);
		schema = parsed.schema ?? parsed;
	} catch (e) {
		console.error('Could not read schema.json from old folder:', e.message);
		process.exit(1);
	}

	const dataFileName = settings.imageDataFileName ?? 'image-data.json';
	const imagesSubdir = 'files';

	const newBase = path.join(rootPath, 'images');
	await fs.mkdir(newBase, { recursive: true });

	const newSettings = {
		displayName: 'Images',
		kind: 'images',
		schema,
		dataFileName,
		filesSubdir: imagesSubdir,
		gridSize: settings.gridSize ?? 'medium',
		autoAdvanceToNextUnlinked: settings.autoAdvanceToNextUnlinked ?? false,
		autoSaveOnAdvance: settings.autoSaveOnAdvance ?? false
	};
	await fs.writeFile(
		path.join(newBase, 'settings.json'),
		JSON.stringify(newSettings, null, 2),
		'utf-8'
	);
	console.log('Wrote', path.join(newBase, 'settings.json'));

	try {
		await fs.copyFile(oldDataPath, path.join(newBase, dataFileName));
		console.log('Copied', dataFileName);
	} catch (e) {
		console.error('Could not copy image-data.json:', e.message);
	}

	const newFilesDir = path.join(newBase, imagesSubdir);
	try {
		await fs.mkdir(newFilesDir, { recursive: true });
		const entries = await fs.readdir(oldImagesDir, { withFileTypes: true });
		for (const ent of entries) {
			const src = path.join(oldImagesDir, ent.name);
			const dest = path.join(newFilesDir, ent.name);
			if (ent.isFile()) {
				await fs.copyFile(src, dest);
			}
		}
		console.log('Copied image files to', newFilesDir);
	} catch (e) {
		if (e.code === 'ENOENT') {
			console.log('No images/ folder in old directory; created empty files/');
		} else {
			console.error('Could not copy images:', e.message);
		}
	}

	console.log('Done. New layout at', newBase);
	console.log('Set MEDIA_MANAGER_ROOT=' + rootPath + ' and open the app.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
