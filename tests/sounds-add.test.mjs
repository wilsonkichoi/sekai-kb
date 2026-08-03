// sounds-add.test.mjs -- contract tests for scripts/tools/sounds/add.mjs.
//
// Tests the three mechanical requirements of the ingest script:
//   DoD 3: strictly additive (refuse duplicate slug, manifest unchanged)
//   DoD 4: byte-for-byte preservation of surrounding content
//   DoD 5: conversion conditional on extension, ffmpeg check
//
// Run: node --experimental-strip-types --test tests/sounds-add.test.mjs
//
// This file lives under tests/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADD_SCRIPT = join(ROOT, 'scripts', 'tools', 'sounds', 'add.mjs');
const NODE = process.execPath;

const MADE = [];

after(() => {
  for (const dir of MADE) rmSync(dir, { recursive: true, force: true });
});

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sounds-add-test-'));
  MADE.push(dir);
  mkdirSync(join(dir, 'knowledge', 'sounds'), { recursive: true });
  mkdirSync(join(dir, 'public', 'media', 'sounds'), { recursive: true });
  return dir;
}

function runAdd(fixture, args) {
  const cmd = `"${NODE}" --experimental-strip-types "${ADD_SCRIPT}" ${args} --root "${fixture}"`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

describe('DoD 3: strictly additive', () => {
  test('refuses duplicate slug with nonzero exit', () => {
    const dir = makeFixture();
    const mp3 = join(dir, 'public', 'media', 'sounds', 'existing-clip.mp3');
    writeFileSync(mp3, Buffer.from([0xff, 0xfb]));

    const manifest = `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds:
      - title: Existing
        location: Loc
        credit: Cred
        file: /media/sounds/existing-clip.mp3
---
`;
    writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), manifest);

    const input = join(dir, 'input.mp3');
    writeFileSync(input, Buffer.from([0xff, 0xfb]));

    const result = runAdd(
      dir,
      `"${input}" --title "Dup" --location "Dup" --credit "Dup" --category nature --slug existing-clip`,
    );

    assert.notEqual(result.exitCode, 0, 'should exit nonzero');
    assert.match(result.stderr, /already exists/i);

    const after = readFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), 'utf8');
    assert.equal(after, manifest, 'manifest must be byte-identical after refused run');
  });
});

describe('DoD 4: hand-editability preserved byte-for-byte', () => {
  test('preserves YAML comments, non-alpha key order, and multi-line description', () => {
    const dir = makeFixture();
    const existingMp3 = join(dir, 'public', 'media', 'sounds', 'existing.mp3');
    writeFileSync(existingMp3, Buffer.from([0xff, 0xfb]));

    const manifest = `---
# This comment must survive
categories:
  - id: harbor
    title: Harbor  # inline comment
    icon: "\\u2693"
    sounds:
      - file: /media/sounds/existing.mp3
        title: Existing clip
        credit: Someone
        location: >-
          The harbor dock, between
          the fishing boats and the fuel pier
        description: >-
          A multi-line description that spans
          several lines and should be
          preserved exactly as written.
---

Body notes with special chars: & < > "quotes"
`;
    writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), manifest);

    const input = join(dir, 'new-clip.mp3');
    writeFileSync(input, Buffer.from([0xff, 0xfb]));

    const result = runAdd(
      dir,
      `"${input}" --title "New clip" --location "New loc" --credit "New cred" --category harbor`,
    );
    assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);

    const after = readFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), 'utf8');
    const insertedEntry =
      '      - title: "New clip"\n' +
      '        location: "New loc"\n' +
      '        credit: "New cred"\n' +
      '        file: /media/sounds/new-clip.mp3';

    assert.ok(after.includes(insertedEntry), 'should contain the new entry');

    // Remove the inserted lines and compare
    const stripped = after.replace(insertedEntry + '\n', '');
    assert.equal(stripped, manifest, 'everything outside the inserted entry must be byte-identical');
  });
});

describe('DoD 5: conversion conditional, ffmpeg prerequisite explicit', () => {
  test('mp3 input is placed without invoking ffmpeg', () => {
    const dir = makeFixture();
    const manifest = `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`;
    writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), manifest);

    const input = join(dir, 'passthrough.mp3');
    const content = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    writeFileSync(input, content);

    const result = runAdd(
      dir,
      `"${input}" --title "Pass" --location "Loc" --credit "Cred" --category nature`,
    );
    assert.equal(result.exitCode, 0, result.stderr);

    const placed = readFileSync(join(dir, 'public', 'media', 'sounds', 'passthrough.mp3'));
    assert.deepEqual(placed, content, 'mp3 should be copied byte-for-byte without conversion');
  });

  test('non-mp3 input is converted through ffmpeg', () => {
    const dir = makeFixture();
    const manifest = `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`;
    writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), manifest);

    // Generate a minimal valid WAV using ffmpeg (silence, 0.1s)
    const input = join(dir, 'convert-test.wav');
    try {
      execSync(`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -y "${input}"`, {
        stdio: 'pipe',
      });
    } catch {
      // ffmpeg not available; skip this test
      return;
    }

    const result = runAdd(
      dir,
      `"${input}" --title "Conv" --location "Loc" --credit "Cred" --category nature`,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(
      existsSync(join(dir, 'public', 'media', 'sounds', 'convert-test.mp3')),
      'converted mp3 should exist',
    );
  });

  test('ffmpeg absent with non-mp3 input is nonzero exit naming install command', () => {
    const dir = makeFixture();
    const manifest = `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`;
    writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), manifest);

    const input = join(dir, 'needs-convert.wav');
    writeFileSync(input, Buffer.from([0x52, 0x49, 0x46, 0x46])); // RIFF header start

    // Run with a PATH that excludes ffmpeg but includes node
    const nodeBin = dirname(process.execPath);
    const cmd =
      `PATH="${nodeBin}:/usr/bin:/bin" "${NODE}" --experimental-strip-types "${ADD_SCRIPT}" ` +
      `"${input}" --title "X" --location "X" --credit "X" --category nature --root "${dir}"`;

    let result;
    try {
      execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: '/bin/bash' });
      result = { exitCode: 0, stderr: '' };
    } catch (err) {
      result = { exitCode: err.status, stderr: err.stderr || '' };
    }

    assert.notEqual(result.exitCode, 0, 'should exit nonzero when ffmpeg is missing');
    assert.match(result.stderr, /ffmpeg/i, 'should mention ffmpeg');
    assert.match(result.stderr, /brew install ffmpeg|apt install ffmpeg/i, 'should name install command');
  });
});
