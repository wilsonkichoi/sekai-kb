# Soundscape Playbook

How to add a recording to the `/soundscape` page. Hand-editing the manifest is a
first-class path throughout; the script handles the mechanical half (conversion,
file placement, and entry appending) and nothing else.

## Prerequisites

- **ffmpeg** on PATH for non-mp3 input. The script places mp3 files directly;
  anything else (wav, m4a, ogg, flac) is converted through ffmpeg.
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
- **Node 22+** (the project's engine requirement).

## Workflow

### 1. Record

Capture the audio. Any format works; ffmpeg converts to mp3 on ingest. Aim for
30-90 seconds of ambient sound that represents the location.

### 2. Convert and add

```
npm run sounds:add -- <audio-file> \
  --title "Surf wash on the cove shingle" \
  --location "Lantern Cove, north end" \
  --credit "Your Name" \
  --category shoreline \
  --description "The tide dragging back over rounded stones." \
  --date 2026-07-30
```

The script:
- Derives a slug from the filename (override with `--slug`).
- Places (or converts then places) the mp3 into `public/media/sounds/<slug>.mp3`.
- Appends a YAML entry to the named category's `sounds:` list in the manifest.
- Creates `knowledge/sounds/_manifest.md` if it does not exist.

**Slug derivation:** the input filename, lowercased, with non-alphanumeric runs
replaced by a single hyphen, and leading/trailing hyphens stripped. For example,
`Bell Buoy (offshore).wav` becomes `bell-buoy-offshore`. Override with `--slug`
when the default is unclear.

**Multiple files:** pass several audio paths in one invocation when they share
the same metadata (same title, location, credit, category). Each gets its own
slug derived from its filename. For recordings with different metadata, run the
command once per recording.

### 3. Verify

```
npm run sounds:check
```

This gate validates the manifest against the filesystem. It exits nonzero on
missing fields, unresolved files, path escapes, or duplicate category ids. Orphan
mp3s (files that exist but are not referenced) are reported as warnings.

### 4. Build

```
npm run build
```

The `sounds:check` gate runs as part of `postbuild`, so a successful build proves
the manifest is consistent with `public/media/sounds/`.

### 5. Commit

Stage the new mp3, the updated manifest, and any other touched files:

```
git add public/media/sounds/<slug>.mp3 knowledge/sounds/_manifest.md
git commit -m "soundscape: add <title>"
```

## Hand-editing the manifest

The manifest at `knowledge/sounds/_manifest.md` is plain YAML frontmatter. You
can always edit it directly to:

- Reorder entries within a category.
- Edit metadata (title, description, credit, date).
- Move an entry between categories.
- Remove an entry (delete the YAML block and optionally the mp3).
- Add a new category (with `id`, `icon`, `title`, and an empty `sounds: []`).
- Add or edit wishlist entries.

The script will not touch anything outside the entry it appends. Comments, key
order, multi-line descriptions, and blank lines are preserved byte-for-byte.

## The `credit` field

Every recording carries a `credit` field. Under the content license this
attribution is reused whenever the recording is embedded, excerpted, or
redistributed. Write it as you want to be credited: your name, handle, or
organization. Synthesized demo clips credit themselves as such rather than
claiming a place.

## What the script will and will not do

**Will:**
- Place or convert the audio file.
- Append an entry to the named category.
- Create the manifest from scratch when absent.

**Will not:**
- Update an existing entry (edit by hand).
- Delete an entry or its file (delete by hand).
- Reorder entries (reorder by hand).
- Reserialize or reformat the manifest.
- Touch anything outside the appended entry.
