// soundscape-manifest.test.mjs -- run with
// `node --experimental-strip-types --test tests/soundscape-manifest.test.mjs`.
//
// src/lib/sounds.ts is the whole read side of the soundscape page: it turns a
// hand-edited knowledge/sounds/_manifest.md into the list the page renders. The
// page has no player library and no server, so every degradation the DoD names
// has to happen here -- an absent manifest, an empty list, and an entry whose
// audio file was never committed all have to leave the build green while the
// remaining entries still render, and every skipped entry has to say so loudly
// enough to appear in an `astro build` transcript.
//
// These suites are written against the published contract only. Fixtures are
// real directory trees under the OS temp dir, never the repository's own
// knowledge/ or public/.
//
// This file lives under tests/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { MANIFEST_PATH, readSoundscape } from '../src/lib/sounds.ts';

/* ------------------------------------------------------------------ fixtures */

const MADE = [];

after(() => {
  for (const dir of MADE) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway site root. Nothing here touches the repository tree. */
function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'sekai-soundscape-'));
  MADE.push(dir);
  return dir;
}

/** Write the manifest at the contract's path, creating knowledge/sounds/. */
function writeManifest(root, source) {
  const file = join(root, 'knowledge', 'sounds', '_manifest.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return file;
}

/** Place a byte-blob where a site-root-absolute `file` value resolves. */
function writeAudio(root, sitePath) {
  const file = join(root, 'public', sitePath.replace(/^\/+/, ''));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'not really audio, never parsed');
  return file;
}

/** `---` frontmatter + free-form body, the shape a human edits. */
const withFrontmatter = (frontmatter, body = '') => `---\n${frontmatter}\n---\n${body}`;

/** One YAML list item from `key: value` lines. */
const item = (...lines) => lines.map((line, i) => (i === 0 ? `  - ${line}` : `    ${line}`)).join('\n');

/** A `sounds:` list from item() blocks. */
const sounds = (...items) => ['sounds:', ...items].join('\n');

/**
 * A complete, valid entry. Values are deliberately place-neutral and mostly
 * digit-free so that an index assertion cannot match fixture text by accident.
 */
function validItem(overrides = {}) {
  const fields = {
    title: 'Clip One',
    location: 'Site A',
    credit: 'Recorded by Contributor A',
    file: '/media/sounds/one.mp3',
    ...overrides,
  };
  return item(...Object.entries(fields).map(([key, value]) => `${key}: ${value}`));
}

/**
 * Call the module with console.warn swapped out, so clause 11 is asserted
 * rather than dumped into the test transcript. Passing no argument exercises
 * the `root` default.
 */
function call(...args) {
  const original = console.warn;
  const logged = [];
  console.warn = (...parts) => {
    logged.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '));
  };
  try {
    return { result: readSoundscape(...args), logged };
  } finally {
    console.warn = original;
  }
}

/** Clause 11: whatever is in `warnings` also reached the build transcript. */
function assertWarningsWereLogged({ result, logged }) {
  for (const warning of result.warnings) {
    assert.ok(
      logged.some((line) => line.includes(warning)),
      `expected console.warn to carry the warning: ${warning}\nlogged: ${JSON.stringify(logged)}`,
    );
  }
}

/** One warning, its text returned for further assertions. */
function onlyWarning(call_) {
  assert.equal(
    call_.result.warnings.length,
    1,
    `expected exactly one warning, got ${JSON.stringify(call_.result.warnings)}`,
  );
  assertWarningsWereLogged(call_);
  return call_.result.warnings[0];
}

const titles = (result) => result.entries.map((entry) => entry.title);

/* ---------------------------------------------------------------- the suites */

describe('MANIFEST_PATH', () => {
  test('is the underscore-prefixed path the knowledge scanners skip', () => {
    // The `_` prefix is mandatory: three knowledge/ scanners skip `_`-prefixed
    // files, so a rename to `manifest.md` would publish the manifest as an
    // article.
    assert.equal(MANIFEST_PATH, 'knowledge/sounds/_manifest.md');
  });

  test('a manifest written without the underscore is not read', () => {
    const root = makeRoot();
    const stray = join(root, 'knowledge', 'sounds', 'manifest.md');
    mkdirSync(dirname(stray), { recursive: true });
    writeFileSync(stray, withFrontmatter(sounds(validItem()), 'body'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result } = call(root);
    assert.deepEqual(result, { entries: [], notes: '', warnings: [] });
  });
});

describe('a well-formed manifest (clauses 1, 9, 10)', () => {
  test('returns every declared field of an entry, and nothing else', () => {
    const root = makeRoot();
    // The date is unquoted, the form a human actually writes, so the expected
    // value is the normalized ISO string of clause 7.
    writeManifest(root, withFrontmatter(sounds(validItem({ date: '2026-03-14' })), 'Notes for a human.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.entries, [
      {
        title: 'Clip One',
        location: 'Site A',
        credit: 'Recorded by Contributor A',
        file: '/media/sounds/one.mp3',
        date: '2026-03-14T00:00:00.000Z',
      },
    ]);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, [], 'a clean manifest must not warn at all');
  });

  test('resolves a declared file under <root>/public/', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem({ file: '/media/sounds/nested/deep/one.mp3' }))));
    writeAudio(root, '/media/sounds/nested/deep/one.mp3');

    const { result } = call(root);
    assert.deepEqual(titles(result), ['Clip One']);
  });

  test('resolves against the root it was given, not another tree', () => {
    // The audio exists, but under a different site root. Resolving relative to
    // anything other than `root` would let this entry through.
    const elsewhere = makeRoot();
    writeAudio(elsewhere, '/media/sounds/one.mp3');
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));

    const { result } = call(root);
    assert.deepEqual(result.entries, []);
    assert.equal(result.warnings.length, 1);
  });

  test('root defaults to process.cwd()', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), 'Body from cwd.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const before = process.cwd();
    let call_;
    try {
      process.chdir(root);
      call_ = call();
    } finally {
      process.chdir(before);
    }
    assert.deepEqual(titles(call_.result), ['Clip One']);
    assert.equal(call_.result.notes, 'Body from cwd.');
  });

  test('preserves manifest order among the entries that survive', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
          validItem({ title: 'Clip Four', file: '/media/sounds/four.mp3' }),
        ),
      ),
    );
    // Two survive, and they are not adjacent in the manifest.
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const { result } = call(root);
    assert.deepEqual(titles(result), ['Clip One', 'Clip Three']);
  });

  test('notes is the body, trimmed', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(sounds(validItem()), '\n\nHow these were recorded.\n\nSecond paragraph.\n\n\n'),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const { result } = call(root);
    assert.equal(result.notes, 'How these were recorded.\n\nSecond paragraph.');
  });

  test('notes is the empty string when the body is empty or whitespace', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), '   \n\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    assert.equal(call(root).result.notes, '');
  });
});

describe('DoD 3(a): the manifest is absent (clause 2)', () => {
  const empty = { entries: [], notes: '', warnings: [] };

  test('no knowledge/ directory at all', () => {
    const root = makeRoot();
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('knowledge/sounds/ exists but holds no manifest', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'knowledge', 'sounds'), { recursive: true });
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('the manifest path is unreadable', () => {
    // A directory where the file should be: readFileSync throws EISDIR. The
    // contract puts an unreadable manifest in the same bucket as an absent one,
    // warnings included.
    const root = makeRoot();
    mkdirSync(join(root, 'knowledge', 'sounds', '_manifest.md'), { recursive: true });
    const { result, logged } = call(root);
    assert.deepEqual(result, empty);
    assert.deepEqual(logged, []);
  });

  test('an absent manifest never throws', () => {
    assert.doesNotThrow(() => readSoundscape(makeRoot()));
  });
});

describe('DoD 3(b): the list is empty or missing (clause 3)', () => {
  const cases = [
    ['no frontmatter at all', ''],
    ['frontmatter without a sounds key', 'title: Soundscape'],
    ['an explicitly empty inline list', 'sounds: []'],
    ['a sounds key with a null value', 'sounds:'],
  ];

  for (const [what, frontmatter] of cases) {
    test(`${what} yields no entries and no warnings`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter, 'Human notes survive.\n'));

      const { result, logged } = call(root);
      assert.deepEqual(result.entries, []);
      assert.deepEqual(result.warnings, [], 'an empty list is a supported state, not a defect');
      assert.deepEqual(logged, []);
      assert.equal(result.notes, 'Human notes survive.');
    });
  }
});

describe('sounds is present but not a list (clause 4)', () => {
  const cases = [
    ['a scalar string', 'sounds: not a list', /string/i],
    ['a number', 'sounds: 4', /number/i],
    ['a mapping', 'sounds:\n  one: /media/sounds/one.mp3', /object|map/i],
  ];

  for (const [what, frontmatter, typeMatch] of cases) {
    test(`${what} is reported once, naming the manifest path and the type`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(frontmatter));

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(
        warning.includes(MANIFEST_PATH),
        `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
      );
      assert.match(warning, typeMatch);
    });
  }
});

describe('an item with a missing or non-string required field (clause 5)', () => {
  const required = ['title', 'location', 'credit', 'file'];

  for (const field of required) {
    test(`a missing ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      const fields = { title: 'Clip One', location: 'Site A', credit: 'Recorded by Contributor A', file: '/media/sounds/one.mp3' };
      delete fields[field];
      writeManifest(root, withFrontmatter(sounds(item(...Object.entries(fields).map(([k, v]) => `${k}: ${v}`)))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });

    test(`a non-string ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ [field]: '\n      - a nested list' }))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });

    test(`an empty-string ${field} skips the item and names the field`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ [field]: '""' }))));
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes(field), `expected the warning to name "${field}", got: ${warning}`);
    });
  }

  test('one warning names every field the item got wrong', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(sounds(item('location: Site A', 'file: /media/sounds/one.mp3'))),
    );
    writeAudio(root, '/media/sounds/one.mp3');

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('title'), `expected the warning to name "title", got: ${warning}`);
    assert.ok(warning.includes('credit'), `expected the warning to name "credit", got: ${warning}`);
  });

  test('the warning names the offending item by its 0-based index', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          item('title: Clip Two', 'location: Site A', 'file: /media/sounds/two.mp3'),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One', 'Clip Three']);
    const warning = onlyWarning(call_);
    assert.match(warning, /\b1\b/, `expected the warning to name index 1, got: ${warning}`);
  });

  for (const [what, yaml] of [
    ['a bare string', '  - /media/sounds/one.mp3'],
    ['a number', '  - 7'],
    ['a nested list', '  - - title: Clip One'],
    ['a null hole', '  -'],
  ]) {
    test(`${what} in place of an item is skipped with a warning naming its index`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(['sounds:', yaml].join('\n')));

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.match(warning, /\b0\b/, `expected the warning to name index 0, got: ${warning}`);
    });
  }
});

describe('the file value must be a safe site-root-absolute path (clause 6)', () => {
  for (const [what, file] of [
    ['a root-relative path with no leading slash', 'media/sounds/one.mp3'],
    ['a bare filename', 'one.mp3'],
    ['a parent-directory escape', '/../secrets.mp3'],
    ['a parent-directory segment in the middle', '/media/../../etc/hosts.mp3'],
    ['a parent segment that resolves back inside public/', '/media/sounds/../sounds/one.mp3'],
  ]) {
    test(`${what} is rejected, naming the title and the value`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
      // The path a naive existence check would resolve to is really there, so a
      // passing run proves the value was rejected on its shape, not its absence.
      writeAudio(root, '/media/sounds/one.mp3');

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(warning.includes('Clip One'), `expected the warning to name the title, got: ${warning}`);
      assert.ok(warning.includes(file), `expected the warning to name "${file}", got: ${warning}`);
    });
  }

  // `path.join` treats `\` as a separator on Windows, so `/media\..\..\x.mp3`
  // resolves outside public/ there, while a `/`-only split sees one harmless
  // segment and lets it through. The fixture writes the file at the literal name
  // a POSIX run resolves, so a value that is merely *missing* would not produce
  // this warning -- the assertion only passes if the shape itself was rejected.
  for (const [what, file] of [
    ['a backslash parent-directory escape', '/media\\..\\..\\secrets.mp3'],
    ['a backslash parent segment in the middle', '/media\\..\\sounds\\one.mp3'],
  ]) {
    test(`${what} is rejected on its shape, on every platform`, () => {
      const root = makeRoot();
      writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
      writeAudio(root, file);

      const call_ = call(root);
      assert.deepEqual(call_.result.entries, []);
      const warning = onlyWarning(call_);
      assert.ok(
        warning.includes('site-root-absolute'),
        `expected rejection on shape, not on absence, got: ${warning}`,
      );
      assert.ok(warning.includes(file), `expected the warning to name "${file}", got: ${warning}`);
    });
  }

  test('a filename that merely contains two dots is not a parent segment', () => {
    // `..` is rejected as a path *segment*. A dotted filename is legal, and a
    // substring test for '..' would wrongly drop this entry.
    const root = makeRoot();
    const file = '/media/sounds/take..one.mp3';
    writeManifest(root, withFrontmatter(sounds(validItem({ file }))));
    writeAudio(root, file);

    const { result, logged } = call(root);
    assert.deepEqual(titles(result), ['Clip One']);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });

  test('a rejected path does not take the rest of the list with it', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: 'media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
        ),
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/two.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip Two']);
    onlyWarning(call_);
  });
});

describe('date normalization (clause 7)', () => {
  /** Read one entry back out of a manifest whose single item carries `date`. */
  function dateOf(dateLine) {
    const root = makeRoot();
    const fields = dateLine === null ? {} : { date: dateLine };
    writeManifest(root, withFrontmatter(sounds(validItem(fields))));
    writeAudio(root, '/media/sounds/one.mp3');
    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One'], 'a date must never skip an entry');
    assert.deepEqual(call_.result.warnings, [], 'a date must never produce a warning');
    return call_.result.entries[0].date;
  }

  test('an unquoted YAML date becomes an ISO-8601 string, not String(Date)', () => {
    // gray-matter hands back a JS Date here. String(date) yields a
    // locale-dependent form like "Sat Mar 14 2026 00:00:00 GMT-0700" that breaks
    // sort and .slice(0, 10); only toISOString() satisfies this assertion.
    const value = dateOf('2026-03-14');
    assert.match(value, /^\d{4}-\d{2}-\d{2}T/, `expected an ISO-8601 date, got: ${value}`);
    assert.equal(value, '2026-03-14T00:00:00.000Z');
  });

  test('an unquoted YAML timestamp keeps its time of day', () => {
    assert.equal(dateOf('2026-03-14T09:30:00Z'), '2026-03-14T09:30:00.000Z');
  });

  test('a quoted date string is carried through unchanged', () => {
    assert.equal(dateOf('"2026-03-14"'), '2026-03-14');
  });

  test('a truthy non-string becomes its String() form', () => {
    assert.equal(dateOf('2026'), '2026');
  });

  test('an absent date is null', () => {
    assert.equal(dateOf(null), null);
  });

  test('an empty date key is null', () => {
    assert.equal(dateOf(''), null);
  });

  test('an empty-string date is null', () => {
    assert.equal(dateOf('""'), null);
  });

  test('an unparseable date string is kept, and never skips the entry', () => {
    assert.equal(dateOf('"sometime last winter"'), 'sometime last winter');
  });
});

describe('DoD 3(c): a declared file missing from public/ (clause 8)', () => {
  test('the entry is skipped and the warning names the title and the file', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }))));
    mkdirSync(join(root, 'public', 'media', 'sounds'), { recursive: true });

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('Clip One'), `expected the warning to name the title, got: ${warning}`);
    assert.ok(
      warning.includes('/media/sounds/gone.mp3'),
      `expected the warning to name the declared file, got: ${warning}`,
    );
  });

  test('no public/ directory at all is the same case, not a crash', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem())));

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    onlyWarning(call_);
  });

  test('the remaining entries still render, in manifest order', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
          validItem({ title: 'Clip Three', file: '/media/sounds/three.mp3' }),
        ),
        'Notes stay.\n',
      ),
    );
    writeAudio(root, '/media/sounds/one.mp3');
    writeAudio(root, '/media/sounds/three.mp3');

    const call_ = call(root);
    assert.deepEqual(titles(call_.result), ['Clip One', 'Clip Three']);
    assert.equal(call_.result.notes, 'Notes stay.');
    const warning = onlyWarning(call_);
    assert.ok(warning.includes('Clip Two'), `expected the warning to name the skipped title, got: ${warning}`);
  });

  test('one warning per missing file, all of them on the build transcript', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/one.mp3' }),
          validItem({ title: 'Clip Two', file: '/media/sounds/two.mp3' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.warnings.length, 2);
    assertWarningsWereLogged(call_);
  });
});

describe('warnings reach the build transcript (clause 11)', () => {
  test('every warning is emitted through console.warn during the call', () => {
    const root = makeRoot();
    writeManifest(
      root,
      withFrontmatter(
        sounds(
          validItem({ title: 'Clip One', file: '/media/sounds/gone.mp3' }),
          item('location: Site A', 'credit: Recorded by Contributor A', 'file: /media/sounds/two.mp3'),
          validItem({ title: 'Clip Three', file: 'media/sounds/three.mp3' }),
        ),
      ),
    );

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.warnings.length, 3, JSON.stringify(call_.result.warnings));
    assertWarningsWereLogged(call_);
  });

  test('a clean manifest emits nothing at all', () => {
    const root = makeRoot();
    writeManifest(root, withFrontmatter(sounds(validItem()), 'Notes.\n'));
    writeAudio(root, '/media/sounds/one.mp3');

    const { result, logged } = call(root);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(logged, []);
  });
});

describe('malformed YAML frontmatter (clause 12)', () => {
  test('is treated as an unreadable manifest, with one warning naming the path', () => {
    const root = makeRoot();
    // An unterminated double-quoted scalar: gray-matter propagates a
    // YAMLException that readSoundscape must absorb.
    writeManifest(root, withFrontmatter('sounds: []\ntitle: "unterminated', 'Body.\n'));

    const call_ = call(root);
    assert.deepEqual(call_.result.entries, []);
    assert.equal(call_.result.notes, '');
    const warning = onlyWarning(call_);
    assert.ok(
      warning.includes(MANIFEST_PATH),
      `expected the warning to name ${MANIFEST_PATH}, got: ${warning}`,
    );
  });
});

describe('readSoundscape never throws (clause 12)', () => {
  const hostile = [
    ['an empty file', ''],
    ['a body with no frontmatter', 'Just notes, no fences.\n'],
    ['an unterminated quoted scalar', withFrontmatter('sounds: "[', 'Body.\n')],
    ['a mapping value where a key belongs', withFrontmatter('sounds: a: b: c')],
    ['a tab-indented item', withFrontmatter('sounds:\n\t- title: Clip One')],
    ['frontmatter fences with nothing between them', '---\n---\n'],
    ['a list of nulls', withFrontmatter('sounds:\n  -\n  -\n  -')],
    ['deeply nested junk', withFrontmatter('sounds:\n  - title:\n      nested:\n        deeper: [1, 2, 3]')],
    ['a file value that is a list', withFrontmatter(sounds(validItem({ file: '\n      - /media/sounds/one.mp3' })))],
    ['a title that is a mapping', withFrontmatter(sounds(validItem({ title: '\n      inner: value' })))],
    ['a date that is a mapping', withFrontmatter(sounds(validItem({ date: '\n      inner: value' })))],
    ['a very long file value', withFrontmatter(sounds(validItem({ file: `/media/sounds/${'x'.repeat(4000)}.mp3` })))],
  ];

  for (const [what, source] of hostile) {
    test(`${what} returns a well-formed result instead of throwing`, () => {
      const root = makeRoot();
      writeManifest(root, source);

      let call_;
      assert.doesNotThrow(() => {
        call_ = call(root);
      });
      assert.ok(Array.isArray(call_.result.entries), 'entries must be an array');
      assert.ok(Array.isArray(call_.result.warnings), 'warnings must be an array');
      assert.equal(typeof call_.result.notes, 'string', 'notes must be a string');
      assertWarningsWereLogged(call_);
    });
  }
});
