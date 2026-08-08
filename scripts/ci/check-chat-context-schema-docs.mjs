#!/usr/bin/env node
// check-chat-context-schema-docs.mjs -- the chat-context manifest schema documentation gate.
//
// `src/lib/chat-contexts.ts` is the only implementation of the
// `knowledge/chat/_contexts.md` schema, and three documents restate that schema in
// prose: dev_docs/SPEC.md (New builds, 6), the manifest's own body, and
// docs/runbook/DEPLOY.md -- the last of which SURVIVES adoption and is therefore the
// copy most adopters actually read.
//
// The engine -- derivation from the reader's exported arrays, anchor matching, scope
// rules, and reporting -- lives in scripts/lib/schema-docs.mjs, shared with the
// soundscape gate. This file is the registry: which statement describes which field
// group, and nothing else.
//
// Usage: node scripts/ci/check-chat-context-schema-docs.mjs   (run from anywhere)
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { fileURLToPath } from 'node:url';

import { runSchemaDocsGate } from '../lib/schema-docs.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const READER = 'src/lib/chat-contexts.ts';

const GROUPS = {
  'context required': { reader: READER, constName: 'CONTEXT_REQUIRED_FIELDS' },
  'context optional': { reader: READER, constName: 'CONTEXT_OPTIONAL_FIELDS' },
};

// Each entry's `anchor` has exactly one capture group, capturing ONLY the
// enumeration. Anchors carry prose, never field names.

const SPEC = 'dev_docs/SPEC.md';
const MANIFEST = 'knowledge/chat/_contexts.md';
const RUNBOOK = 'docs/runbook/DEPLOY.md';

const REGISTRY = [
  {
    file: SPEC,
    label: 'New builds (6), context required fields',
    group: 'context required',
    scope: 'instance',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (6), context optional fields',
    group: 'context optional',
    scope: 'instance',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, context required fields',
    group: 'context required',
    scope: 'instance',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, context optional fields',
    group: 'context optional',
    scope: 'instance',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s*\n?#?\s*([^:]+):/,
  },
  {
    file: RUNBOOK,
    label: 'runbook, context required fields',
    group: 'context required',
    scope: 'framework',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: RUNBOOK,
    label: 'runbook, context optional fields',
    group: 'context optional',
    scope: 'framework',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
];

runSchemaDocsGate({
  name: 'chat context schema docs guard',
  root: ROOT,
  groups: GROUPS,
  registry: REGISTRY,
});
