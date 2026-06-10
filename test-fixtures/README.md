# test-fixtures

A **pristine, committed sample data root** for manually testing the built app. It contains
one media type of every kind so all storage/UI code paths can be exercised:

| Folder       | Kind         | Notes                                                        |
| ------------ | ------------ | ------------------------------------------------------------ |
| `files/`     | `blob_store` | The shared global blob dir; holds all binaries (browse-only) |
| `images/`    | `images`     | Links the three PNGs in `files/` with schema metadata        |
| `documents/` | `generic`    | Links the sample `.txt` in `files/` (any extension allowed)  |
| `notes/`     | `json`       | Two records, no file attachment                              |
| `globals/`   | `json`       | The reserved singleton record                                |

All binaries live in `files/` (the single global blob store, `getGlobalFilesDir()`), and
each catalog references them by `file_name` — see the "Shared global blob store" invariant
in `CLAUDE.md`.

## How to use it

```bash
npm run test:serve        # builds if needed, copies this seed to a gitignored
                          # test-data/ working copy, and serves it on :3000
npm run test:serve -- --no-open
```

**Do not point the app directly at this folder.** Running the app mutates its data root
(heals settings, writes data files, can rename/strip blob references), which would dirty
the committed seed. `test:serve` always serves a throwaway copy at `test-data/`.

## Keeping the seed current

When you change on-disk structure — `settings.json` / data-file layout, reserved-group
behavior, or media-kind semantics — **update this seed in the same change** (the same
discipline as `docs/FEATURES.md`). The reliable way to regenerate it: serve a scratch
root, recreate the types via the UI/API, then copy the result back here.
