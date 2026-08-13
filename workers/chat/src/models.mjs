// workers/chat/src/models.mjs — the model ids this worker is pinned to.
//
// They live apart from index.mjs for the same reason ./sql.mjs does, plus one that is
// not optional: `main` points at index.mjs, and the Workers runtime rejects any named
// export from the entry module that is not a handler. A `export const CHAT_MODEL = '...'`
// there fails the isolate at startup with "Incorrect type for map entry 'CHAT_MODEL'",
// before a single request, while `node --test` imports the module happily and reports
// green. So a constant a suite needs is exported from here and imported by both.
//
// EMBED_MODEL is re-exported rather than restated: the model that embedded the corpus is
// a property of the artifact, and workers/lib/corpus.mjs is what compares them.

export { EMBED_MODEL } from '../../lib/corpus.mjs';

export const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
