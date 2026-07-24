#!/usr/bin/env node
// check-rule-registry.mjs — CI guard for the dev-plugin rule registry.
//
// Under the dev-plugin project-bootstrap DISCOVERY contract (dev 0.0.64+,
// runtime_contracts/project-bootstrap.md), the resolver walks `rules_dir` and
// loads every Markdown file by its `tier` frontmatter; an unclassified file is a
// hard stop, never a silent drop. This checker is the fast CI complement to that
// runtime guard: it asserts every rule file under the configured `rules_dir`
// declares a valid tier (doctrine / gotcha+trigger / none), that no rule file
// carries an `@` import (rule files are terminal under discovery), and that the
// `## Rules` section of the dev config carries no bare `@path` line (a leftover
// registry import would make a harness inline every gotcha each session,
// defeating triggers).
//
// This file is dev-plugin state and lives under `.agent-toolkit/`; an adopter
// stripped by the init wizard removes the whole tree, so the CI step that calls
// it is guarded by the presence of `.agent-toolkit/dev.md` (see deploy.yml).
//
// Usage:
//   node .agent-toolkit/scripts/check-rule-registry.mjs            validate this repo
//   node .agent-toolkit/scripts/check-rule-registry.mjs --selftest prove it catches an unclassified rule

import { readdirSync, readFileSync, existsSync, statSync, realpathSync, symlinkSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_TIERS = new Set(['doctrine', 'gotcha', 'none']);
const TRIGGER_KEYS = new Set(['paths', 'objective', 'definition_of_done']);
const IMPORT_LINE = /^\s*@\S+\s*$/;

// Strip one layer of matching surrounding quotes and a trailing ` # comment`.
function cleanScalar(value) {
  const v = value.trim();
  const quoted = v.match(/^(['"])(.*?)\1(?:\s+#.*)?$/);
  if (quoted) return quoted[2];
  return v.split(/\s+#/, 1)[0].trim();
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return m ? m[1] : null;
}

function scalar(body, name) {
  const m = body.match(new RegExp(`^${name}:\\s*(.*?)\\s*$`, 'm'));
  return m ? cleanScalar(m[1]) || null : null;
}

// Count trigger items exactly as the resolver's trigger_metadata parses them:
// `triggers:` line, keys at 2-space indent, items at 4-space indent under a
// valid key, stopping at the first non-indented line.
function triggerItemCount(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => l.replace(/\s+$/, '') === 'triggers:');
  if (start === -1) return 0;
  let current = null;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (line && !/^[ \t]/.test(line)) break;
    const key = line.match(/^\s{2}([a-z_]+):\s*$/);
    if (key) {
      current = TRIGGER_KEYS.has(key[1]) ? key[1] : null;
      continue;
    }
    const item = line.match(/^\s{4}-\s+(.+?)\s*$/);
    if (item && current && cleanScalar(item[1])) count++;
  }
  return count;
}

function readRulesDir(repoRoot) {
  const config = join(repoRoot, '.agent-toolkit', 'dev.md');
  if (!existsSync(config)) {
    return { error: `.agent-toolkit/dev.md not found under ${repoRoot}` };
  }
  const text = readFileSync(config, 'utf8');
  const body = frontmatter(text);
  if (!body) return { error: '.agent-toolkit/dev.md has no frontmatter' };
  const rulesDir = scalar(body, 'rules_dir');
  if (!rulesDir) return { error: '.agent-toolkit/dev.md frontmatter has no rules_dir' };
  return { rulesDir: rulesDir.replace(/\/+$/, ''), configText: text };
}

// Enumerate every Markdown file under `dir`, mirroring resolve_project_rules.py's
// discovery: FOLLOW symlinks for classification (a symlinked `.md` is a real
// discovered rule and must be tier-checked), but REJECT any symlink whose target
// escapes the repository — the same path-escape guarantee the resolver enforces.
// `Dirent.isDirectory()/isFile()` do not follow symlinks, so classify via
// `statSync` (which does) and record escape/broken-link errors so the checker
// fails exactly where the resolver would hard-stop. `repoReal` is the canonical
// repo root (both sides canonicalized so the macOS /var→/private/var symlink does
// not read as an escape). `visited` guards symlink cycles.
function walkMarkdown(dir, repoReal, acc, errors, visited = new Set()) {
  let dirReal;
  try { dirReal = realpathSync(dir); } catch { return; }
  if (visited.has(dirReal)) return;
  visited.add(dirReal);
  let dst;
  try { dst = statSync(dir); } catch { return; }
  if (!dst.isDirectory()) return;
  const relRepo = (x) => relative(repoReal, x).split(sep).join('/');
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try { target = realpathSync(p); }
      catch { errors.push(`${relRepo(p)}: broken symlink (rule discovery cannot resolve its target)`); continue; }
      const rel = relative(repoReal, target);
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        errors.push(`${relRepo(p)}: symlink target escapes the repository (${target}); rule discovery rejects it`);
        continue;
      }
    }
    let s;
    try { s = statSync(p); } catch { continue; } // follows symlink to its target
    if (s.isDirectory()) walkMarkdown(p, repoReal, acc, errors, visited);
    else if (s.isFile() && entry.name.endsWith('.md')) acc.push(p);
  }
}

// Bare `@path` lines under the `## Rules` section of the dev config.
function bareImportLinesUnderRules(configText) {
  const lines = configText.split('\n');
  const start = lines.findIndex((l) => /^##\s+Rules\s*$/.test(l));
  if (start === -1) return [];
  const hits = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break; // next section
    if (IMPORT_LINE.test(line)) hits.push(line.trim());
  }
  return hits;
}

export function validate(repoRoot) {
  const errors = [];
  const { rulesDir, configText, error } = readRulesDir(repoRoot);
  if (error) return [error];

  for (const bare of bareImportLinesUnderRules(configText)) {
    errors.push(`## Rules carries a bare @path line (registry double-duty; discovery ignores it and a harness would inline it): ${bare}`);
  }

  const root = realpathSync(repoRoot); // canonical, so symlink escape checks are exact
  const absRulesDir = join(root, rulesDir);
  const files = [];
  walkMarkdown(absRulesDir, root, files, errors);
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    if (text.split('\n').some((l) => IMPORT_LINE.test(l))) {
      errors.push(`${rel}: rule file carries an @ import line (rule files are terminal under discovery)`);
    }
    const body = frontmatter(text);
    if (!body) {
      errors.push(`${rel}: ${text.startsWith('---\n') ? 'malformed frontmatter' : 'no frontmatter'} (needs tier)`);
      continue;
    }
    const tier = scalar(body, 'tier');
    if (!tier) {
      errors.push(`${rel}: frontmatter does not declare tier`);
    } else if (!VALID_TIERS.has(tier)) {
      errors.push(`${rel}: unknown tier '${tier}' (expected doctrine|gotcha|none)`);
    } else if (tier === 'gotcha' && triggerItemCount(body) === 0) {
      errors.push(`${rel}: tier: gotcha declares no trigger (needs >=1 under paths/objective/definition_of_done)`);
    }
  }
  return errors;
}

function selftest() {
  const tmp = mkdtempSync(join(tmpdir(), 'rule-registry-selftest-'));
  try {
    mkdirSync(join(tmp, '.agent-toolkit', 'rules'), { recursive: true });
    writeFileSync(
      join(tmp, '.agent-toolkit', 'dev.md'),
      '---\nrules_dir: .agent-toolkit/rules/\n---\n\n## Rules\n\nplaceholder\n',
    );
    // A correctly-classified rule the checker must accept.
    writeFileSync(
      join(tmp, '.agent-toolkit', 'rules', 'good.md'),
      '---\ntier: gotcha\ntriggers:\n  paths:\n    - "scripts/**/*.sh"\n---\n# good\n',
    );
    // A deliberately unclassified rule the checker MUST reject.
    writeFileSync(join(tmp, '.agent-toolkit', 'rules', 'bad.md'), '# bad rule, no frontmatter\n');

    // A symlink inside rules_dir pointing at an in-repo but unclassified Markdown
    // file: discovery follows it and it must be tier-checked, so the checker MUST
    // reject it (the resolver hard-stops on the same case).
    writeFileSync(join(tmp, 'stray-unclassified.md'), '# stray, no frontmatter\n');
    symlinkSync(join('..', '..', 'stray-unclassified.md'), join(tmp, '.agent-toolkit', 'rules', 'linked-bad.md'));

    // A symlink whose target escapes the repository: discovery rejects it, so the
    // checker MUST flag it rather than silently skip.
    const outside = mkdtempSync(join(tmpdir(), 'rule-registry-outside-'));
    writeFileSync(join(outside, 'escapes.md'), '---\ntier: gotcha\ntriggers:\n  paths:\n    - "x"\n---\n# even a valid tier must not escape\n');
    symlinkSync(join(outside, 'escapes.md'), join(tmp, '.agent-toolkit', 'rules', 'escapes.md'));

    try {
      const errors = validate(tmp);
      const checks = [
        ['unclassified rule bad.md', errors.some((e) => e.includes('rules/bad.md'))],
        ['symlink to in-repo unclassified linked-bad.md', errors.some((e) => e.includes('rules/linked-bad.md'))],
        ['repo-escaping symlink escapes.md', errors.some((e) => e.includes('rules/escapes.md') && e.includes('escapes the repository'))],
      ];
      const missed = checks.filter(([, caught]) => !caught);
      if (missed.length) {
        console.error(`SELFTEST FAILED: checker did not reject: ${missed.map(([n]) => n).join('; ')}`);
        console.error(errors.join('\n') || '(no errors reported)');
        return 1;
      }
      if (errors.some((e) => e.includes('rules/good.md'))) {
        console.error('SELFTEST FAILED: checker wrongly rejected the valid rule good.md');
        console.error(errors.join('\n'));
        return 1;
      }
      console.log('SELFTEST OK: checker rejects unclassified rules, symlinks to unclassified targets, and repo-escaping symlinks; accepts a valid gotcha.');
      return 0;
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const errors = validate(process.cwd());
  if (errors.length) {
    console.error('Rule registry check FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log('Rule registry OK: every rule file under rules_dir declares a valid tier; no bare @path registry lines.');
  return 0;
}

process.exit(main());
