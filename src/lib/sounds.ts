/**
 * sounds.ts — the `knowledge/sounds/` manifest reader.
 *
 * The soundscape page is the one surface whose data lives in `knowledge/` but is
 * not an article. The manifest is Markdown so `knowledge/` stays Markdown, and it
 * is named `_manifest.md` because the leading underscore is what makes it
 * invisible to every scanner that walks `knowledge/`:
 *
 *   - scripts/core/test-frontmatter.mjs   discovers categories from the filesystem,
 *                                         then filters `!f.startsWith('_')`
 *   - scripts/tools/article-health.py     globs `*.md`, skipping `startswith("_")`
 *   - scripts/core/build-content-dates.mjs returns null for `file.startsWith('_')`
 *
 * Rename it without that prefix and the article pipeline starts treating it as an
 * article with no title, description, or category.
 *
 * The whole manifest is optional. An adopted instance ships no `knowledge/sounds/`
 * at all (the init wizard removes the demo tree), so every read path here degrades
 * to an empty result instead of throwing: `readFileSync` inside `try/catch`, never
 * `await import()` — Rollup resolves a literal import specifier before any catch
 * handler runs, so the try/catch around a dynamic import of a missing file is dead
 * code (`.agent-toolkit/rules/optional-build-time-json-readfilesync.md`).
 *
 * This file lives under src/, which both machine gates scan: its source is pure
 * ASCII and carries no place-specific string.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

/** Repository-relative path of the manifest. The `_` prefix is load-bearing. */
export const MANIFEST_PATH = 'knowledge/sounds/_manifest.md';

/** Public-directory prefix a manifest `file` is resolved against on disk. */
const PUBLIC_DIR = 'public';

export interface SoundEntry {
  /** Display title of the recording. */
  title: string;
  /** Where it was captured, in the instance's own words. */
  location: string;
  /** Attribution. Synthesized demo clips say so here rather than claiming a place. */
  credit: string;
  /** Site-root-absolute public path, e.g. `/media/sounds/clip.mp3`. */
  file: string;
  /** ISO-8601 string, or null when the entry declares no date. */
  date: string | null;
}

export interface SoundscapeManifest {
  /** Entries that survived validation, in manifest order. */
  entries: SoundEntry[];
  /** The manifest body (free-form human notes), trimmed. */
  notes: string;
  /** Build-time diagnostics. Also emitted through `console.warn`. */
  warnings: string[];
}

/** The four required fields, in the order a diagnostic should name them. */
const REQUIRED_FIELDS = ['title', 'location', 'credit', 'file'] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * gray-matter silently coerces an unquoted YAML `date: 2026-07-30` to a JavaScript
 * `Date`. `String(date)` on one of those yields a locale-dependent, non-ISO form
 * that breaks lexicographic sort and `.slice(0, 10)`, so normalize at the boundary
 * (`.agent-toolkit/rules/gray-matter-date-normalization.md`).
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/** A `file` must stay inside `public/`: site-root-absolute, no `..` segment. */
function isSafePublicPath(file: string): boolean {
  if (!file.startsWith('/')) return false;
  return !file.split('/').includes('..');
}

/**
 * Reads the manifest under `root` (default: the current working directory, which
 * is the repository root during `astro build`).
 *
 * Never throws. An absent manifest, an absent `sounds` list, and an empty list all
 * return zero entries — the page renders its documented empty state. A malformed
 * entry, an unsafe `file`, or a `file` with no matching asset under `public/` skips
 * that entry alone and records a warning naming it; every other entry still renders.
 */
export function readSoundscape(root: string = process.cwd()): SoundscapeManifest {
  const manifestPath = resolve(root, MANIFEST_PATH);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    // No soundscape in this instance. The page's empty state is the contract.
    return { entries: [], notes: '', warnings: [] };
  }

  const warnings: string[] = [];

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(
      `${MANIFEST_PATH}: frontmatter could not be parsed (${reason}); no entries rendered.`,
    );
    return emit({ entries: [], notes: '', warnings });
  }

  const notes = String(parsed.content ?? '').trim();
  const declared = (parsed.data as Record<string, unknown>)?.sounds;

  if (declared === undefined || declared === null) {
    return emit({ entries: [], notes, warnings });
  }
  if (!Array.isArray(declared)) {
    warnings.push(
      `${MANIFEST_PATH}: \`sounds\` must be a list, got ${typeof declared}; no entries rendered.`,
    );
    return emit({ entries: [], notes, warnings });
  }

  const entries: SoundEntry[] = [];

  declared.forEach((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      warnings.push(
        `${MANIFEST_PATH}: entry ${index} is not a mapping; skipped.`,
      );
      return;
    }

    const record = item as Record<string, unknown>;
    const invalid = REQUIRED_FIELDS.filter((f) => !isNonEmptyString(record[f]));
    if (invalid.length > 0) {
      warnings.push(
        `${MANIFEST_PATH}: entry ${index} is missing or has a non-string ${invalid.join(', ')}; skipped.`,
      );
      return;
    }

    const title = (record.title as string).trim();
    const file = (record.file as string).trim();

    if (!isSafePublicPath(file)) {
      warnings.push(
        `${MANIFEST_PATH}: entry "${title}" declares an unusable file "${file}"; ` +
          'a file must be a site-root-absolute path with no ".." segment. Skipped.',
      );
      return;
    }

    if (!existsSync(join(root, PUBLIC_DIR, file))) {
      warnings.push(
        `${MANIFEST_PATH}: entry "${title}" declares "${file}", which does not exist ` +
          `under ${PUBLIC_DIR}/. Skipped; the remaining entries still render.`,
      );
      return;
    }

    entries.push({
      title,
      location: (record.location as string).trim(),
      credit: (record.credit as string).trim(),
      file,
      date: normalizeDate(record.date),
    });
  });

  return emit({ entries, notes, warnings });
}

/**
 * Emit every diagnostic to the build log before returning it. Warning at the source
 * is what makes a missing asset visible in a real `astro build` transcript rather
 * than depending on each caller remembering to print what it was handed.
 */
function emit(result: SoundscapeManifest): SoundscapeManifest {
  for (const warning of result.warnings) console.warn(warning);
  return result;
}
