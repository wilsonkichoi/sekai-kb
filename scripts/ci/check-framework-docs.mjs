#!/usr/bin/env node
// check-framework-docs.mjs -- the framework maintainer-doc gate (ADR 008).
//
// The framework's own PRD, SPEC, ROADMAP, and ADRs live in this repository and are
// removed by `npm run init`, because they describe how sekai-kb is built, never how
// an instance is operated. Three claims that arrangement rests on can drift silently,
// and each one is DERIVED here from the source it describes rather than restated:
//
//   1. STRIP CONTRACT -- the set of paths adoption removes comes from
//      `scripts/init/writer.mjs`'s exported MAINTAINER_DOCS. In template mode every
//      listed path must exist (a rename that made the strip a no-op is a failure, not
//      a pass), both adopter doc trees must survive, and NO file that an adopter keeps
//      may carry a link into a removed path. A dangling reference in an adopted clone
//      is worse than none: the reader cannot tell a deleted document from one that
//      never existed.
//   2. MERGE=OURS LIST -- the instance-owned file list comes from `.gitattributes`.
//      SPEC §Repo topology and ADR 006's consequences both enumerate it in prose; that
//      list has drifted from reality before (ADR 006 exists partly to correct it).
//   3. BUILD PIPELINE -- the prebuild and post-build job names come from
//      `package.json`. SPEC §Build pipeline enumerates both.
//
// Registered statements live in documents that adoption REMOVES, so they are required
// in template mode and reported as skipped in an adopted instance -- the same rule
// `check-scan-root-docs.mjs` applies to instance-owned prose.
//
// Failure modes, all exit 1:
//   - MAINTAINER_DOCS cannot be parsed out of the wizard (the derivation, and so this
//     whole guard, would otherwise silently weaken);
//   - a path the wizard strips does not exist in the template checkout;
//   - an adopter doc tree is missing;
//   - a file that survives adoption links into a stripped path;
//   - a registered enumeration disagrees with the source it describes;
//   - a registered anchor is NOT FOUND -- someone reworded, moved, or deleted the
//     statement. An unfindable statement is exactly how a stale one hides.
//
// Success prints one summary line and exits 0.
//
// Usage: node scripts/ci/check-framework-docs.mjs [--root <dir>]
//        node scripts/ci/check-framework-docs.mjs --selftest
//
// This file lives under scripts/, which both genericity gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WIZARD = 'scripts/init/writer.mjs';
const GITATTRIBUTES = '.gitattributes';
const PACKAGE_JSON = 'package.json';

// Adopter-facing doc trees. Not derived: this is the contract's other half -- the
// wizard removes what it lists, and these two are what must survive that removal.
// They are how an adopter writes articles and operates the site.
const ADOPTER_DOC_TREES = ['docs/playbook', 'docs/runbook'];

// Paths adoption removes beyond the maintainer docs. Anything under them is out of
// the dangling-reference scan for the same reason the maintainer docs are: an adopter
// never sees the file, so it cannot dangle for them.
const OTHER_REMOVED_AT_ADOPTION = ['.agent-toolkit', '.sekai-template'];

// Files the wizard REGENERATES wholesale (writer.mjs: renderAgentsMd, CLAUDE_MD_SHIM,
// renderReadme, renderChangelog). Whatever the framework's copy says, the adopter's
// copy is freshly rendered text that carries none of it.
const REGENERATED_AT_ADOPTION = ['AGENTS.md', 'CLAUDE.md', 'README.md', 'CHANGELOG.md'];

// Files that must name the stripped paths in order to strip, assert, or gate them.
// A path in a removal list or a guard registry is data, not a link a reader follows,
// and each of these already handles the adopted case: the wizard removes only what is
// present, and both guards report a registered statement in a removed document as
// skipped rather than missing. Keep this list to strip mechanisms only — exempting an
// ordinary document here would hollow the scan out.
const STRIP_MECHANISM_FILES = [
  WIZARD,
  'scripts/init/check-init.sh',
  'scripts/ci/check-framework-docs.mjs',
  'scripts/ci/check-scan-root-docs.mjs',
];

const PRUNED_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.venv', '__pycache__']);
const PRUNED_PATHS = ['src/content', 'src/data', 'public/kb'];

/* -- Derivations: every expectation comes from the source, never from here -- */

// writer.mjs declares the strip list as one array literal:
//   export const MAINTAINER_DOCS = ['docs/PRD.md', ...];
function deriveMaintainerDocs(src) {
  const m = /export\s+const\s+MAINTAINER_DOCS\s*=\s*\[([^\]]*)\]/.exec(src);
  if (!m) return null;
  const docs = m[1]
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return docs.length > 0 ? docs : null;
}

// .gitattributes declares instance ownership one path per line: `<path> merge=ours`.
function deriveMergeOursPaths(src) {
  const paths = [];
  for (const line of src.split('\n')) {
    const m = /^(\S+)\s+merge=ours\s*$/.exec(line);
    if (m) paths.push(m[1]);
  }
  return paths;
}

// package.json composes the two pipeline halves as npm script chains:
//   "prebuild": "... && run-p prebuild:a prebuild:b ... && ..."
//   "postbuild": "run-s postbuild:a postbuild:b ..."
function derivePipelineJobs(pkgJson, script, runner, prefix) {
  const command = pkgJson.scripts?.[script];
  if (typeof command !== 'string') return null;
  const m = new RegExp(`${runner}\\s+((?:${prefix}:[\\w-]+\\s*)+)`).exec(command);
  if (!m) return null;
  return m[1]
    .trim()
    .split(/\s+/)
    .map((job) => job.slice(prefix.length + 1))
    .filter(Boolean);
}

const asSet = (items) => [...new Set(items)].sort().join(', ');

/**
 * A captured enumeration may span lines and carry markdown backticks, list
 * indentation, and comment markers. Strip those, then split on commas.
 */
function parseList(span) {
  return span
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#|\/\/|\*|-)\s?/, ''))
    .join(' ')
    .split(',')
    .map((token) => token.trim().replace(/^(?:and|or)\s+/i, ''))
    .map((token) => token.replace(/[`'"\\]/g, '').trim())
    .map((token) => token.replace(/\/+$/, ''))
    .filter(Boolean);
}

/* -- The registry: which prose statement restates which derived list -- */
//
// Each anchor has exactly one capture group holding ONLY the enumeration. Anchors
// carry prose, never list members, so they stay valid when the source changes and
// fail loudly when the prose is reworded.

const REGISTRY = [
  {
    file: 'docs/SPEC.md',
    label: 'Repo topology, instance-owned merge=ours list',
    source: 'merge-ours',
    anchor: /`merge=ours`\s+on\s+instance-owned\s*\n?\s*files\s+\(([^)]+)\)/,
  },
  {
    file: 'docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
    label: 'Consequences, instance-owned merge=ours list',
    source: 'merge-ours',
    anchor: /The\s+`merge=ours`\s+list\s+is\s+now:\s*([\s\S]*?)\.\n/,
  },
  {
    file: 'docs/SPEC.md',
    label: 'Build pipeline, parallel prebuild jobs',
    source: 'prebuild',
    anchor: /parallel\s+prebuild\s+\(`run-p`:\s*([^)]+)\)/,
  },
  {
    file: 'docs/SPEC.md',
    label: 'Build pipeline, post-build contract checks',
    source: 'postbuild',
    anchor: /contract\s+checks\s+\(`run-s`:\s*([^)]+)\)/,
  },
];

/* -- Tree walk -- */

function* walk(root, dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) continue;
      if (PRUNED_PATHS.includes(rel)) continue;
      yield* walk(root, abs);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

const isUnder = (rel, prefix) => rel === prefix || rel.startsWith(`${prefix}/`);

/* -- The three checks -- */

function run(root) {
  const failures = [];
  const skipped = [];
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const templateMode = existsSync(join(root, '.sekai-template'));

  /* 1. Strip contract. */

  let wizardSource;
  try {
    wizardSource = read(WIZARD);
  } catch (err) {
    return { failures: [`${WIZARD}: cannot be read (${err.message}); the strip list cannot be derived.`], skipped, checked: 0 };
  }
  const maintainerDocs = deriveMaintainerDocs(wizardSource);
  if (!maintainerDocs) {
    return {
      failures: [
        `${WIZARD}: no MAINTAINER_DOCS array literal found -- this guard cannot derive ` +
          'what adoption removes. Re-point the derivation in the same commit that moves it.',
      ],
      skipped,
      checked: 0,
    };
  }

  if (templateMode) {
    for (const rel of maintainerDocs) {
      if (!existsSync(join(root, rel))) {
        failures.push(
          `${rel}: listed in ${WIZARD}'s MAINTAINER_DOCS but absent from this template ` +
            'checkout. The wizard would strip nothing -- the doc was renamed or deleted ' +
            'without updating the list.',
        );
      }
    }
    for (const rel of ADOPTER_DOC_TREES) {
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        failures.push(`${rel}/: adopter doc tree is missing; adoption must keep it (ADR 008).`);
      }
      if (maintainerDocs.some((doc) => isUnder(rel, doc) || isUnder(doc, rel))) {
        failures.push(`${rel}/: adopter doc tree overlaps a stripped path in ${WIZARD}'s MAINTAINER_DOCS.`);
      }
    }
  } else {
    skipped.push('strip-list presence (adopted instance: the wizard already ran)');
  }

  const removed = [...maintainerDocs, ...OTHER_REMOVED_AT_ADOPTION];
  const exempt = new Set([...REGENERATED_AT_ADOPTION, ...STRIP_MECHANISM_FILES]);
  let scannedFiles = 0;
  let danglingChecked = 0;

  for (const rel of walk(root, root)) {
    if (removed.some((prefix) => isUnder(rel, prefix))) continue;
    if (exempt.has(rel)) continue;
    let text;
    try {
      text = read(rel);
    } catch {
      continue; // unreadable (permissions, races): not this guard's concern
    }
    if (text.includes('\u0000')) continue; // binary
    scannedFiles += 1;
    for (const doc of maintainerDocs) {
      let index = text.indexOf(doc);
      while (index !== -1) {
        const line = text.slice(0, index).split('\n').length;
        failures.push(
          `${rel}:${line}: links into "${doc}", which adoption removes. An adopter ` +
            'would follow a reference to a file they do not have. Re-point it at the ' +
            'upstream repository, or drop the reference (ADR 008).',
        );
        index = text.indexOf(doc, index + doc.length);
      }
      danglingChecked += 1;
    }
  }

  if (scannedFiles === 0) {
    failures.push(
      'the dangling-reference scan visited zero files, so it proved nothing. Check the ' +
        'prune list and the exemptions.',
    );
  }

  /* 2 + 3. Registered enumerations against their derived sources. */

  const expected = {};
  try {
    expected['merge-ours'] = asSet(deriveMergeOursPaths(read(GITATTRIBUTES)));
  } catch (err) {
    failures.push(`${GITATTRIBUTES}: cannot be read (${err.message}).`);
  }
  if (expected['merge-ours'] === '') {
    failures.push(`${GITATTRIBUTES}: no \`<path> merge=ours\` lines found -- the instance-owned list cannot be derived.`);
  }
  try {
    const pkg = JSON.parse(read(PACKAGE_JSON));
    const pre = derivePipelineJobs(pkg, 'prebuild', 'run-p', 'prebuild');
    const post = derivePipelineJobs(pkg, 'postbuild', 'run-s', 'postbuild');
    if (!pre) failures.push(`${PACKAGE_JSON}: no \`run-p prebuild:*\` chain found in the prebuild script.`);
    if (!post) failures.push(`${PACKAGE_JSON}: no \`run-s postbuild:*\` chain found in the postbuild script.`);
    if (pre) expected.prebuild = asSet(pre);
    if (post) expected.postbuild = asSet(post);
  } catch (err) {
    failures.push(`${PACKAGE_JSON}: cannot be read or parsed (${err.message}).`);
  }

  let checked = 0;
  for (const site of REGISTRY) {
    if (expected[site.source] === undefined) continue; // derivation already failed above
    const abs = join(root, site.file);
    const registeredInRemovedDoc = removed.some((prefix) => isUnder(site.file, prefix));

    if (!existsSync(abs)) {
      if (registeredInRemovedDoc && !templateMode) {
        skipped.push(`${site.file} (removed at adoption)`);
      } else {
        failures.push(
          `${site.file}: registered file is missing (${site.label}). A registered ` +
            'statement that cannot be checked is a failure, not a pass.',
        );
      }
      continue;
    }

    const text = readFileSync(abs, 'utf8');
    const match = site.anchor.exec(text);
    if (!match) {
      failures.push(
        `${site.file}: anchor NOT FOUND for "${site.label}". The statement was reworded, ` +
          "moved, or deleted -- re-point this guard's registry entry in the same commit.",
      );
      continue;
    }

    const found = asSet(parseList(match[1]));
    if (found !== expected[site.source]) {
      const line = text.slice(0, match.index).split('\n').length;
      failures.push(
        `${site.file}:${line}: ${site.label} (derived from ${
          site.source === 'merge-ours' ? GITATTRIBUTES : PACKAGE_JSON
        })\n` +
          `      found:    ${found || '(none)'}\n` +
          `      expected: ${expected[site.source]}`,
      );
      continue;
    }
    checked += 1;
  }

  return { failures, skipped, checked, scannedFiles, danglingChecked, maintainerDocs, templateMode };
}

/* -- Self-test: the detectors must be able to fail -- */
//
// A guard over four absent paths and three enumerations passes just as happily when
// its scan is empty or its comparison unreachable. This builds a synthetic tree,
// plants each defect class, and requires a failure naming it.

function selftest() {
  const fixture = mkdtempSync(join(tmpdir(), 'framework-docs-selftest-'));
  const write = (rel, content) => {
    mkdirSync(join(fixture, rel, '..'), { recursive: true });
    writeFileSync(join(fixture, rel), content);
  };
  const build = () => {
    rmSync(fixture, { recursive: true, force: true });
    mkdirSync(fixture, { recursive: true });
    write('.sekai-template', 'marker\n');
    write(WIZARD, "export const MAINTAINER_DOCS = ['docs/PRD.md', 'docs/adr'];\n");
    write('docs/PRD.md', 'framework product doc\n');
    write('docs/adr/001-x.md', 'a decision\n');
    write('docs/playbook/ARTICLE-PLAYBOOK.md', 'editorial canon\n');
    write('docs/runbook/DEPLOY.md', 'operations\n');
    write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\n');
    write(
      PACKAGE_JSON,
      `${JSON.stringify(
        { scripts: { prebuild: 'run-p prebuild:search prebuild:related', postbuild: 'run-s postbuild:smoke' } },
        null,
        2,
      )}\n`,
    );
    write(
      'docs/SPEC.md',
      'Determinism comes from `merge=ours` on instance-owned files (`CLAUDE.md`,\n' +
        '`knowledge/**`), plus the ownership rule.\n\n' +
        '`sync.sh` -> parallel prebuild (`run-p`: related, search) -> `astro build` ->\n' +
        'contract checks (`run-s`: smoke).\n',
    );
    write(
      'docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
      'The `merge=ours` list is now: `CLAUDE.md`, `knowledge/**`.\n',
    );
  };

  const cases = [
    {
      what: 'a surviving file that links into a stripped path',
      plant: () => write('docs/runbook/DEPLOY.md', 'See docs/PRD.md for intent.\n'),
      expect: /links into "docs\/PRD\.md"/,
    },
    {
      what: 'a stripped path the template no longer has',
      plant: () => rmSync(join(fixture, 'docs/PRD.md')),
      expect: /absent from this template checkout/,
    },
    {
      what: 'a removed adopter doc tree',
      plant: () => rmSync(join(fixture, 'docs/runbook'), { recursive: true }),
      expect: /adopter doc tree is missing/,
    },
    {
      what: 'a merge=ours entry missing from the prose list',
      plant: () => write(GITATTRIBUTES, 'CLAUDE.md merge=ours\nknowledge/** merge=ours\nCNAME merge=ours\n'),
      expect: /Repo topology, instance-owned merge=ours list/,
    },
    {
      what: 'a prebuild job missing from the prose list',
      plant: () =>
        write(
          PACKAGE_JSON,
          `${JSON.stringify(
            {
              scripts: {
                prebuild: 'run-p prebuild:search prebuild:related prebuild:graph',
                postbuild: 'run-s postbuild:smoke',
              },
            },
            null,
            2,
          )}\n`,
        ),
      expect: /Build pipeline, parallel prebuild jobs/,
    },
    {
      what: 'a reworded (unfindable) registered statement',
      plant: () =>
        write(
          'docs/adr/006-adopter-owned-agents-md-and-dev-plugin-encapsulation.md',
          'The `merge=ours` set currently covers: `CLAUDE.md`, `knowledge/**`.\n',
        ),
      expect: /anchor NOT FOUND/,
    },
    {
      what: 'an unparseable MAINTAINER_DOCS declaration',
      plant: () => write(WIZARD, 'export const OTHER = 1;\n'),
      expect: /no MAINTAINER_DOCS array literal found/,
    },
  ];

  try {
    build();
    const baseline = run(fixture);
    if (baseline.failures.length > 0) {
      console.error('FAIL: framework-docs self-test -- the guard fails on the clean fixture:');
      for (const f of baseline.failures) console.error(`  ${f}`);
      return 1;
    }

    for (const testCase of cases) {
      build();
      testCase.plant();
      const result = run(fixture);
      const report = result.failures.join('\n');
      if (result.failures.length === 0) {
        console.error(`FAIL: framework-docs self-test -- the guard did NOT catch ${testCase.what}.`);
        return 1;
      }
      if (!testCase.expect.test(report)) {
        console.error(
          `FAIL: framework-docs self-test -- the guard caught ${testCase.what} for the wrong reason:\n${report}`,
        );
        return 1;
      }
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }

  console.log(
    `OK: framework-docs self-test passed -- the guard catches all ${cases.length} planted defect classes`,
  );
  return 0;
}

/* -- Entry point -- */

function parseRoot(argv) {
  const i = argv.indexOf('--root');
  if (i === -1) return fileURLToPath(new URL('../..', import.meta.url));
  if (!argv[i + 1]) {
    console.error('FAIL: --root needs a directory');
    process.exit(2);
  }
  return argv[i + 1];
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  process.exit(selftest());
}

const root = parseRoot(argv);
const result = run(root);

if (result.failures.length > 0) {
  console.error('FAIL: framework maintainer-doc contract violated:');
  for (const f of result.failures) console.error(`  ${f}`);
  console.error('');
  console.error(`  strip list (${WIZARD}): ${(result.maintainerDocs ?? []).join(', ') || '(underivable)'}`);
  console.error(`  adopter doc trees kept: ${ADOPTER_DOC_TREES.join(', ')}`);
  process.exit(1);
}

const mode = result.templateMode ? 'template mode' : 'instance mode';
const skips = result.skipped.length ? `; skipped: ${result.skipped.join(', ')}` : '';
console.log(
  `OK: framework maintainer-doc gate passed [${mode}] -- ${result.checked} enumeration(s) match ` +
    `their source, ${result.scannedFiles} surviving file(s) carry no link into ` +
    `${result.maintainerDocs.join(', ')}${skips}`,
);
