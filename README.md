# media-manager

Local-first data manager built with SvelteKit + Svelte 5. Manages metadata for multiple media types: **images** (files + metadata) and **pure JSON** (metadata only, e.g. projects list).

## What it does

- **Multi-media-type**: Open the app to see an overview of media types (e.g. Images, Projects). Each type lives in its own folder under a root directory.
- **Images**: Store image files and custom metadata (schema-driven fields). Upload, link/unlink, edit properties, delete.
- **Pure JSON**: Store records with no file attachment (e.g. a list of projects with title, description, links, tags). Same schema-driven fields and filters.
- **Schema = settings**: Each media type has one `settings.json` containing display name, kind, schema (field definitions), and app preferences (grid size, etc.).

## Running locally

The app requires a **root directory**. Set `MEDIA_MANAGER_ROOT` before running:

```bash
npm install
MEDIA_MANAGER_ROOT=./my-data npm run dev
```

Create the root folder first:

```bash
mkdir -p my-data
```

Open the app in the browser. You’ll see the **overview** of media types (empty at first). Use **Create new** to add a media type (e.g. "Images" or "Projects"). Each type gets its own subfolder under the root.

## Data layout

**Root folder** (e.g. `./my-data`) contains one **subfolder per media type**. The app scans the root for subfolders that contain a valid `settings.json` (our format). No manifest file.

### Images media type (e.g. `my-data/images/`)

- **settings.json** – display name, `kind: "images"`, `schema` (field definitions), app settings (grid size, etc.), `dataFileName`, `filesSubdir`
- **image-data.json** (or name in settings) – image records `{ id, file_name, linked, ...custom fields }`
- **files/** (or name in settings) – the image files

### Pure JSON media type (e.g. `my-data/projects/`)

- **settings.json** – display name, `kind: "json"`, `schema`, app settings, `dataFileName`
- **data.json** (or name in settings) – records `{ id, last_modified?, ...custom fields }`

## Migration from the old single-folder layout

If you previously used a single folder (e.g. `my-images/` with `settings.json`, `schema.json`, `image-data.json`, and `images/` inside):

1. Create a root folder and an `images` subfolder, e.g. `my-data/images/`.
2. Move your **image files** from `my-images/images/` into `my-data/images/files/` (or keep the name `images` and set `filesSubdir` in settings).
3. Merge **schema into settings**: create `my-data/images/settings.json` with:
   - `displayName`: e.g. `"Images"`
   - `kind`: `"images"`
   - `schema`: copy the contents of your old `schema.json` (the `schema` object).
   - `dataFileName`: `"image-data.json"`
   - `filesSubdir`: `"files"` (or `"images"` if you kept that name)
   - `gridSize`, etc. from your old `settings.json`
4. Move **image-data.json** into `my-data/images/image-data.json`.

**Optional migration script** (copies old folder into root/images/ with merged settings):

```bash
node scripts/migrate-to-media-types.mjs ./my-images ./my-data
```

The folder name (e.g. `images`) is the **media type id**; the display name is in `settings.json` and can be renamed in the UI.

## Key concepts

- **Stable identity**: Records are identified by a UUID (`id`). The UI does not put filenames in the URL.
- **Discovery**: The app scans the root folder for subfolders that contain a valid `settings.json`. No manifest.
- **Media type id** = folder name (e.g. `images`, `projects`). Renaming the display name in the UI does not change the folder name.

## CLI

Build and run with the root directory as the first argument:

```bash
npm run build
node build/index.js
# Set env: MEDIA_MANAGER_ROOT=/path/to/root
# Or use the CLI wrapper if available:
# media-manager /path/to/root
```

Or with `npx` (if published):

```bash
npx media-manager ./my-data
```

Optional: `--body-size-limit N` (bytes) for upload limits.

**Warning:** the default upload limit is for **local use only**. If you expose the server on a network, use a smaller limit or run behind a proxy.

## Scripts

- `npm run dev`: dev server (requires `MEDIA_MANAGER_ROOT`)
- `npm run build`: production build
- `npm run preview`: preview build
- `npm run start`: run node adapter build (`node build`)
- `npm run check`: svelte check
- `npm run lint`: prettier + eslint
- `npm run test`: unit tests (vitest)
