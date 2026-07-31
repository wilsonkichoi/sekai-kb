// queue.mjs -- the SNIPPET-INBOX.md format: parse, validate, publish, write back.
//
// The queue file is human-edited Markdown, so every mutation here is a
// line-level edit of the `- status:` and `- url:` lines of one entry. The file
// is never re-serialized from the parse tree: an operator's spacing, comments,
// and hand-written notes survive a publish run byte-for-byte.
//
// Entry grammar (outside fenced code blocks):
//
//   ## snippet-<id>
//
//   - slug: <Category>/<article-slug>
//   - created: YYYY-MM-DD
//   - chars: <integer>
//   - status: pending | approved | posted | rejected
//   - url: <https URL, empty until posted>
//
//   ```text
//   <the post text, verbatim>
//   ```
//
// Headings inside a fenced block are text, not entries, so the file header can
// carry a worked example of the format without the parser reading it as queue
// state.
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

export const STATUSES = ['pending', 'approved', 'posted', 'rejected'];

const ENTRY_HEADING = /^## (snippet-[a-z0-9][a-z0-9-]*)\s*$/;
const FIELD = /^- ([a-z]+):[ \t]*(.*)$/;
// CommonMark fence rule: a fence is closed only by a run of the SAME character
// that is at least as long as the opening run. That is what lets this file's own
// header wrap a worked example -- backticks and all -- in a longer fence without
// the parser reading the example's inner fences, or its `## snippet-` heading,
// as queue state.
const FENCE = /^\s*(`{3,}|~{3,})/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_FIELDS = ['slug', 'created', 'chars', 'status', 'url'];

/** A malformed queue file. Never repaired silently: a human wrote it. */
export class QueueError extends Error {
  constructor(problems) {
    super(`SNIPPET-INBOX.md is malformed:\n  - ${problems.join('\n  - ')}`);
    this.name = 'QueueError';
    this.problems = problems;
  }
}

/** Unicode code points, which is what every short-form platform counts. */
export function charCount(text) {
  return [...text].length;
}

/**
 * Parse the queue into entries plus the raw lines they were read from.
 *
 * Throws `QueueError` listing every problem at once, so a human fixing the file
 * sees the whole picture rather than one error per rerun.
 */
export function parseQueue(source) {
  const lines = source.split('\n');
  const entries = [];
  const problems = [];

  let fence = null; // the open fence's marker run, or null outside any fence
  let current = null;

  const finish = () => {
    if (!current) return;
    entries.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const marker = FENCE.exec(line)?.[1];
    if (fence === null && marker) {
      // A fence inside an entry that has no text yet opens the post text.
      // Anywhere else it is just prose in the header.
      if (current && current.text === null) current.textStart = i + 1;
      fence = marker;
      continue;
    }
    if (fence !== null) {
      const closes = marker && marker[0] === fence[0] && marker.length >= fence.length;
      if (!closes) continue;
      if (current && current.textStart !== null && current.text === null) {
        current.text = lines.slice(current.textStart, i).join('\n');
      }
      fence = null;
      continue;
    }

    const heading = ENTRY_HEADING.exec(line);
    if (heading) {
      finish();
      current = {
        id: heading[1],
        line: i,
        fields: {},
        fieldLines: {},
        textStart: null,
        text: null,
      };
      continue;
    }

    // A non-entry heading closes the entry that preceded it.
    if (/^#{1,6} /.test(line)) {
      finish();
      continue;
    }

    if (!current) continue;
    const field = FIELD.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key in current.fields) {
      problems.push(`${current.id}: duplicate field "${key}" (line ${i + 1})`);
      continue;
    }
    current.fields[key] = value.trim();
    current.fieldLines[key] = i;
  }
  finish();

  const seen = new Set();
  for (const entry of entries) {
    const where = `${entry.id} (line ${entry.line + 1})`;
    if (seen.has(entry.id)) {
      problems.push(`${where}: duplicate entry id`);
    }
    seen.add(entry.id);

    for (const key of REQUIRED_FIELDS) {
      if (!(key in entry.fields)) problems.push(`${where}: missing "- ${key}:" field`);
    }
    if (entry.text === null) {
      problems.push(`${where}: no fenced post-text block`);
    } else if (entry.text.trim() === '') {
      problems.push(`${where}: post text is empty`);
    }

    const status = entry.fields.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      problems.push(`${where}: status "${status}" is not one of ${STATUSES.join(' | ')}`);
    }
    if (entry.fields.created !== undefined && !DATE.test(entry.fields.created)) {
      problems.push(`${where}: created "${entry.fields.created}" is not YYYY-MM-DD`);
    }
    if (entry.fields.slug !== undefined && entry.fields.slug === '') {
      problems.push(`${where}: slug is empty`);
    }

    // `chars` is redundant with the text on purpose: it is what a human reads
    // when deciding whether a draft fits, so a text edit that leaves it stale is
    // a defect the parser must catch rather than quietly recompute around.
    if (entry.fields.chars !== undefined && entry.text !== null) {
      const declared = entry.fields.chars;
      const actual = charCount(entry.text);
      if (!/^\d+$/.test(declared)) {
        problems.push(`${where}: chars "${declared}" is not an integer`);
      } else if (Number(declared) !== actual) {
        problems.push(`${where}: chars says ${declared} but the post text is ${actual}`);
      }
    }

    const url = entry.fields.url ?? '';
    if (status === 'posted' && url === '') {
      problems.push(`${where}: status is posted but url is empty`);
    }
    if (url !== '' && !isHttpUrl(url)) {
      problems.push(`${where}: url "${url}" is not an http(s) URL`);
    }
  }

  if (problems.length > 0) throw new QueueError(problems);

  return {
    lines,
    entries: entries.map((entry) => ({
      id: entry.id,
      slug: entry.fields.slug,
      created: entry.fields.created,
      chars: Number(entry.fields.chars),
      status: entry.fields.status,
      url: entry.fields.url,
      text: entry.text,
      fieldLines: entry.fieldLines,
    })),
  };
}

export function isHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

/**
 * Publish every `approved` entry through `adapter`, returning the updated file
 * text alongside what happened to each entry.
 *
 * An entry longer than `adapter.maxChars` is REFUSED, never truncated: the text
 * is what a human approved, and silently cutting it publishes something nobody
 * signed off on. A refusal leaves the entry `approved` so a shortened rerun
 * picks it up.
 */
export async function publishApproved(source, adapter, { log = () => {} } = {}) {
  const { lines, entries } = parseQueue(source);
  const published = [];
  const refused = [];
  const skipped = [];

  for (const entry of entries) {
    if (entry.status !== 'approved') {
      skipped.push({ id: entry.id, status: entry.status });
      continue;
    }

    if (entry.chars > adapter.maxChars) {
      const over = entry.chars - adapter.maxChars;
      refused.push({
        id: entry.id,
        reason:
          `${entry.chars} chars exceeds the ${adapter.id} adapter's maxChars ` +
          `(${adapter.maxChars}) by ${over}. Shorten the post text and rerun; ` +
          'the runner never truncates an approved draft.',
      });
      continue;
    }

    let result;
    try {
      result = await adapter.publish({
        id: entry.id,
        slug: entry.slug,
        created: entry.created,
        chars: entry.chars,
        text: entry.text,
      });
    } catch (err) {
      refused.push({ id: entry.id, reason: `adapter "${adapter.id}" failed: ${err.message}` });
      continue;
    }

    const url = result?.url;
    if (typeof url !== 'string' || !isHttpUrl(url)) {
      refused.push({
        id: entry.id,
        reason: `adapter "${adapter.id}" returned no http(s) url (got ${JSON.stringify(url)})`,
      });
      continue;
    }

    lines[entry.fieldLines.status] = '- status: posted';
    lines[entry.fieldLines.url] = `- url: ${url}`;
    published.push({ id: entry.id, url });
    log(`posted ${entry.id} -> ${url}`);
  }

  return { text: lines.join('\n'), published, refused, skipped };
}
