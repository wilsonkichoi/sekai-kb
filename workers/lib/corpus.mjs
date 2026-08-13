// workers/lib/corpus.mjs -- the corpus retrieval substrate shared by every Worker that
// answers from the knowledge base.
//
// Two Workers query the same corpus: workers/chat/ (retrieval-augmented answers) and
// workers/mcp/ (the `semantic_search` tool). Before this module they would have carried
// two copies of the decode, the normalization, and the cosine ranking, and -- worse --
// two copies of the artifact, one bundled into each deployment. Two artifacts are two
// corpora the moment one deploy is older than the other, and nothing would say so: both
// Workers would answer confidently from whatever they were built with.
//
// This module is PURE: it never reads the artifact from disk. The bundled artifact is
// bound in ./vectors.mjs, which is the only module that imports vectors.json, so code
// that merely ranks (and every suite that exercises it) does not drag a
// deploy-time-generated file in behind it.
//
// This file lives under workers/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

/**
 * The embedding model the artifact must have been built with. A query embedded by a
 * different model lands in a different vector space, where cosine similarity is
 * meaningless rather than merely wrong, so this is compared and not assumed.
 */
export const EMBED_MODEL = '@cf/baai/bge-m3';

/**
 * Cosine score a chunk must reach to be retrieved. Below it, a chunk is not returned at
 * all -- it never becomes a citation, and never reaches a model as context.
 *
 * Top-k alone cannot express "nothing here is relevant": it slices a fixed count off a
 * sorted list, so a question the corpus cannot answer still yields the k least-bad
 * matches. The floor is what makes an empty retrieval reachable.
 *
 * The default is measured, not chosen: on the template's demo corpus, questions about
 * places the corpus never mentions top out at 0.435 while the weakest genuinely
 * answerable question reaches 0.484. This sits in that gap. Both Workers expose it as a
 * deploy-time var (`RELEVANCE_FLOOR`) rather than a constant, because the separating
 * value is a property of the corpus: docs/runbook/DEPLOY.md has the re-measurement
 * procedure.
 */
export const DEFAULT_RELEVANCE_FLOOR = 0.46;

/** Chunks returned by one retrieval, before the floor is applied. */
export const DEFAULT_TOP_K = 5;

/**
 * Decode one embedding artifact into `{dim, chunks, vectors}`, with `vectors` a flat
 * Int8Array of `count * dim` values.
 *
 * Throws when the artifact is structurally wrong or was built by another model. Callers
 * turn that into a 503 (chat) or a tool error (MCP) rather than letting it surface as a
 * bare runtime failure: a stale or mismatched index is an operator problem with a
 * specific fix, and the message has to survive to say which.
 */
export function decodeArtifact(vectorArtifact) {
  if (vectorArtifact?.model !== EMBED_MODEL) {
    throw new Error('embedding artifact model does not match this worker');
  }
  if (
    vectorArtifact?.schema !== 'rag-v1' ||
    vectorArtifact?.quant !== 'i8-unit' ||
    !Number.isInteger(vectorArtifact?.dim) ||
    vectorArtifact.dim <= 0 ||
    !Array.isArray(vectorArtifact?.chunks) ||
    vectorArtifact?.count !== vectorArtifact.chunks.length ||
    typeof vectorArtifact?.vectors !== 'string'
  ) {
    throw new Error('embedding artifact metadata is incompatible with this worker');
  }

  const binary = atob(vectorArtifact.vectors);
  const vectors = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    const value = binary.charCodeAt(index);
    vectors[index] = value > 127 ? value - 256 : value;
  }
  if (vectors.length !== vectorArtifact.count * vectorArtifact.dim) {
    throw new Error('embedding artifact vector length does not match its metadata');
  }

  return Object.freeze({
    dim: vectorArtifact.dim,
    chunks: vectorArtifact.chunks,
    vectors,
  });
}

/** L2-normalize a float vector, or null when it has no direction. */
export function normalize(vector) {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return vector.map((value) => value / magnitude);
}

/**
 * Rank the corpus against one query embedding and return the surviving chunks, best
 * first, with their scores.
 *
 * Every stored vector is a unit vector scaled to int8, so a plain dot product against
 * the normalized query IS the cosine similarity -- no per-chunk normalization inside
 * the request's CPU budget.
 *
 * The floor is applied BEFORE the top-k slice, which is the whole point of having one:
 * filtering after slicing would still hand back the k least-bad matches whenever fewer
 * than k chunks clear the bar, and an empty result would be unreachable.
 *
 * Throws when the query embedding does not match the corpus dimension, which means the
 * query and the index came from different models.
 */
export function retrieve(queryVector, corpus, options = {}) {
  const { floor = DEFAULT_RELEVANCE_FLOOR, topK = DEFAULT_TOP_K } = options;
  const normalized = normalize(queryVector ?? []);
  if (!normalized || normalized.length !== corpus.dim) {
    throw new Error('query embedding dimension does not match the corpus artifact');
  }

  const ranked = corpus.chunks.map((chunk, chunkIndex) => {
    let score = 0;
    const offset = chunkIndex * corpus.dim;
    for (let dim = 0; dim < corpus.dim; dim += 1) {
      score += normalized[dim] * (corpus.vectors[offset + dim] / 127);
    }
    return { chunk, score };
  });
  ranked.sort((left, right) => right.score - left.score);
  return ranked.filter(({ score }) => score >= floor).slice(0, topK);
}

/**
 * A var holding a cosine score, so the accepted range is [0, 1]. Zero is a real value --
 * it disables the floor -- which is why this cannot use a "> 0 or fall back" rule.
 * Anything unparseable, negative, or above 1 falls back rather than failing the request:
 * a mistyped tuning var must not take a Worker down, and the default is a safe policy.
 * `scripts/deploy/wrangler-config.mjs` rejects a bad value at generation time, where
 * saying no is still cheap and still visible.
 */
export function relevanceFloorVar(value, fallback = DEFAULT_RELEVANCE_FLOOR) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
