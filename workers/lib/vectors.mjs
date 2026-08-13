// workers/lib/vectors.mjs -- the one module that binds the generated corpus artifact.
//
// The artifact lives HERE, beside the retrieval code that reads it, and every Worker
// that retrieves imports this module rather than keeping a sibling copy.
// `npm run embeddings:build` writes exactly one vectors.json, at ./vectors.json, and
// `wrangler deploy` bundles the same bytes into every Worker that pulls this in -- so
// workers/chat/ and workers/mcp/ cannot end up answering out of two different corpora.
//
// THE ARTIFACT IS DERIVED AND GITIGNORED. It carries every article's title, url, and
// body text, and workers/ is a code tree that may hold no place identity (AGENTS.md
// iron rule 2). Both machine gates skip it by BASENAME, so its location inside workers/
// changes neither gate's scan set; scripts/ci/check-worker-config.mjs fails the build
// if git ever tracks one.
//
// PARSED ONCE, NOT PER REQUEST (SPEC negative requirement). The free Workers plan caps
// V8 CPU per request, and a corpus-sized JSON.parse consumes most of that budget on its
// own. The module-level `import ... with { type: 'json' }` is parsed once at isolate
// startup, and `loadCorpus()` memoizes the base64 decode into module scope on first
// call, so every later request in that isolate does zero decoding work. An ES module is
// a singleton within a bundle, which is what makes one memo serve every caller.
//
// This module is separate from ./corpus.mjs so that importing the RANKING code does not
// require the artifact to exist: only a Worker entry point pulls this file in.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import vectorArtifact from './vectors.json' with { type: 'json' };

import { decodeArtifact } from './corpus.mjs';

let decoded;

/** The bundled artifact, decoded once per isolate. Throws on a mismatched artifact. */
export function loadCorpus() {
  if (!decoded) decoded = decodeArtifact(vectorArtifact);
  return decoded;
}
