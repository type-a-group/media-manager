# media-manager

Local-first data manager built with SvelteKit + Svelte 5. Manages metadata for multiple media types: **images** (files + metadata), **generic / files** (loose files in a folder, optional metadata), and **pure JSON** (metadata only, e.g. projects list).

## What it does

- **Multi-media-type**: Open the app to see an overview of media types (e.g. Images, Projects). Each type lives in its own folder under a root directory.
- **Images**: Store image files and custom metadata (schema-driven fields). Upload, link/unlink, edit properties, delete.
- **Files (generic)**: Store arbitrary files in the type folder (not only images). Same UI patterns as images (linked/unlinked, upload, etc.); MIME/extension rules are relaxed for uploads compared to `images`.
- **Pure JSON**: Store records with no file attachment (e.g. a list of projects with title, description, links, tags). Same schema-driven fields and filters.
- **Schema = settings**: Each media type has one `settings.json` containing display name, kind, schema (field definitions), and app preferences (grid size, etc.). On first launch, the app may create default **`files`** (generic) and **`globals`** (json) groups under your root—see [`docs/FEATURES.md`](docs/FEATURES.md) for behavior details.

## Running the production build (typical use)

The shipped app is a **Node server** produced by SvelteKit’s adapter. You build once, then run Node with a data root:

```bash
npm install
npm run build
MEDIA_MANAGER_ROOT=/absolute/path/to/my-data node build
```

Equivalent shortcuts:

```bash
npm start
# same as: MEDIA_MANAGER_ROOT must still be set in the environment unless you use the CLI below
```

**Recommended:** use the **`media-manager`** CLI from the package root (after `npm run build`). It sets `MEDIA_MANAGER_ROOT` for you and opens the browser by default:

```bash
npm run build
node bin/media-manager.js /absolute/path/to/my-data
# or, if the package is linked/globally installed:
# media-manager /absolute/path/to/my-data
```

The server listens on **`PORT`** (default **3000**). Override with `PORT=8080` (or your platform’s env mechanism).

## Development server

For local development with hot reload:

```bash
npm install
MEDIA_MANAGER_ROOT=./my-data npm run dev
```

Create the root folder first:

```bash
mkdir -p my-data
```

Open the app in the browser. You’ll see the **overview** of media types. Use **Create new** to add a media type (Images, Files, or Pure JSON). Each type gets its own subfolder under the root.

## Data layout

**Root folder** (e.g. `./my-data`) contains one **subfolder per media type**. The app scans the root for subfolders that contain a valid `settings.json` (our format). No manifest file.

### Images media type (e.g. `my-data/images/`)

- **settings.json** – display name, `kind: "images"`, `schema` (field definitions), app settings (grid size, etc.), `dataFileName`, `filesSubdir`
- **image-data.json** (or name in settings) – image records `{ id, file_name, linked, ...custom fields }`
- **files/** (or name in settings) – the image files

### Pure JSON media type (e.g. `my-data/projects/`)

- **settings.json** – display name, `kind: "json"`, `schema`, app settings, `dataFileName`
- **data.json** (or name in settings) – records `{ id, last_modified?, ...custom fields }`

### Generic / “files” media type (e.g. `my-data/files/`)

- **settings.json** – display name, `kind: "generic"`, optional `schema`, `dataFileName` (default `data.json`)
- **data.json** – image-catalog format `{ images: [] }` when created via the API (may be created on first use otherwise)
- **Files** live directly in the type folder (no separate `files/` subfolder)

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

## CLI (`media-manager`)

After **`npm run build`**, the CLI expects the **`build/`** directory to exist next to `bin/media-manager.js`. It runs `node build` with `MEDIA_MANAGER_ROOT` set to your first argument.

```bash
npm run build
node bin/media-manager.js /path/to/my-data
```

Flags:

- `--body-size-limit N` — request body size limit in bytes (uploads)
- `--no-open` — do not open a browser when the server starts

Published install (if using `npx` from npm):

```bash
npx media-manager ./my-data
```

**Warning:** default upload limits are for **local use only**. If you expose the server on a network, set a smaller limit or run behind a reverse proxy.

## Developer reference

- **Feature map** (behavior, file locations, API index, known gaps): [`docs/FEATURES.md`](docs/FEATURES.md)

## Scripts

- `npm run dev`: dev server (requires `MEDIA_MANAGER_ROOT`)
- `npm run build`: production build (output in `build/`; run with `node build` or the CLI above)
- `npm run preview`: preview build
- `npm run start`: run the production server (`node build`; set `MEDIA_MANAGER_ROOT` in the environment)
- `npm run check`: svelte check
- `npm run lint`: prettier + eslint
- `npm run test`: unit tests (vitest)
