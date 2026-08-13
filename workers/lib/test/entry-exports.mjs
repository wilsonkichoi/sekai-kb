/**
 * The assertion every Worker entry module owes: it exports only handlers.
 *
 * `main` in a wrangler.toml names one module, and the Workers runtime walks that
 * module's named exports expecting each to be a fetch handler or a Durable Object
 * class. A plain string, object, or array among them fails the isolate at STARTUP:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'CHAT_MODEL': the provided value
 *   is not of type 'function or ExportedHandler'.
 *
 * That is a total outage, before any request, and NOTHING else in this repository
 * catches it. `node --test` imports the entry module rather than starting workerd, so a
 * suite reading `import { SQL } from '../src/index.mjs'` passes while the worker it
 * describes cannot boot. It surfaces at `npx wrangler dev` or `wrangler deploy`, which
 * is a manual step somebody has to reach.
 *
 * Found on LB-95's manual step, against three workers at once (chat, feedback, and the
 * new MCP server), which is why the fix is a shared assertion rather than three edits:
 * a constant re-exported "just for the tests" is the whole failure mode, and the cure is
 * that a suite imports it from the module that owns it.
 *
 * `default` is exempt: it is the handler.
 */

import assert from 'node:assert/strict';

export function assertHandlerOnlyExports(module, label) {
  const offenders = Object.entries(module)
    .filter(([name]) => name !== 'default')
    .filter(([, value]) => typeof value !== 'function')
    .map(([name, value]) => `${name} (${Array.isArray(value) ? 'array' : typeof value})`);

  assert.deepEqual(
    offenders,
    [],
    `${label} is a Worker entry module, so every named export must be a handler or a ` +
      'class. The Workers runtime rejects these at isolate startup, before any request: ' +
      `${offenders.join(', ')}. Move each into its own module and import it there.`,
  );

  assert.equal(typeof module.default?.fetch, 'function', `${label} must export a default fetch handler`);
}
