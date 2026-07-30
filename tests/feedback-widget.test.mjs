import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';

import { chromium } from 'playwright';

const ENDPOINT = 'https://feedback.example.invalid/submit';
const componentSource = readFileSync(
  new URL('../src/components/FeedbackWidget.astro', import.meta.url),
  'utf8',
);

const submitScriptMatch = componentSource.match(
  /const SUBMIT_SCRIPT = `([\s\S]*?)`;\n---/,
);
assert.ok(submitScriptMatch, 'FeedbackWidget.astro must expose its inline submit script');
const submitScript = submitScriptMatch[1];

const noscriptMatch = componentSource.match(/<noscript>([\s\S]*?)<\/noscript>/);
assert.ok(noscriptMatch, 'FeedbackWidget.astro must carry a noscript fallback');
assert.match(
  noscriptMatch[1],
  /href=\{`mailto:\$\{links\.email\}`\}/,
  'the noscript fallback must link to links.email',
);
const noscriptCssMatch = noscriptMatch[1].match(
  /<style is:inline>([\s\S]*?)<\/style>/,
);
assert.ok(noscriptCssMatch, 'the noscript fallback must hide the JavaScript form');
const noscriptCss = noscriptCssMatch[1];

function widgetHtml() {
  return `<!doctype html>
<html>
  <body>
    <noscript>
      <style>${noscriptCss}</style>
      <a data-feedback-email href="mailto:feedback@example.invalid">Email feedback</a>
    </noscript>
    <form
      data-feedback-form
      data-endpoint="${ENDPOINT}"
      data-page="/history/example"
      data-msg-sending="Sending..."
      data-msg-success="Thank you. Your feedback was received."
      data-msg-invalid="Please check the {field} field and try again."
      data-msg-rate-limited="Too many submissions from this network. Please try again later."
      data-msg-error="Could not send your feedback. Please try again later."
    >
      <select name="category"><option value="correction">Correction</option></select>
      <textarea name="message"></textarea>
      <input name="contact" value="">
      <input name="website" value="">
      <button type="submit">Send feedback</button>
      <p data-feedback-status hidden></p>
    </form>
    <script>${submitScript}</script>
  </body>
</html>`;
}

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function submitWith(response) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let payload;

  await page.route(ENDPOINT, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }

    payload = JSON.parse(request.postData());
    if (response === 'network-failure') {
      await route.abort('connectionfailed');
      return;
    }

    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(response.body),
    });
  });

  await page.setContent(widgetHtml());
  await page.locator('textarea[name="message"]').fill('This date needs a correction.');
  await page.locator('input[name="contact"]').fill('reader@example.invalid');
  await page.locator('button[type="submit"]').click();
  const status = page.locator('[data-feedback-status]');
  await status.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-feedback-status]');
    return element?.getAttribute('data-state') !== 'pending';
  });

  return {
    context,
    page,
    payload,
    state: await status.getAttribute('data-state'),
    text: await status.textContent(),
  };
}

test('success posts the worker payload, reports success, and clears the form', async () => {
  const result = await submitWith({ status: 200, body: { ok: true, id: 'feedback-id' } });
  try {
    assert.deepEqual(result.payload, {
      page: '/history/example',
      category: 'correction',
      message: 'This date needs a correction.',
      contact: 'reader@example.invalid',
      website: '',
    });
    assert.equal(result.state, 'success');
    assert.equal(result.text, 'Thank you. Your feedback was received.');
    assert.equal(await result.page.locator('textarea[name="message"]').inputValue(), '');
  } finally {
    await result.context.close();
  }
});

test('a 400 names the rejected field and preserves the message', async () => {
  const result = await submitWith({
    status: 400,
    body: { error: 'too_short', field: 'message' },
  });
  try {
    assert.equal(result.state, 'error');
    assert.equal(result.text, 'Please check the message field and try again.');
    assert.equal(
      await result.page.locator('textarea[name="message"]').inputValue(),
      'This date needs a correction.',
    );
  } finally {
    await result.context.close();
  }
});

test('a 429 reports the rate-limited state', async () => {
  const result = await submitWith({ status: 429, body: { error: 'rate_limited' } });
  try {
    assert.equal(result.state, 'error');
    assert.equal(
      result.text,
      'Too many submissions from this network. Please try again later.',
    );
  } finally {
    await result.context.close();
  }
});

test('a network failure reports the catch-all failure state', async () => {
  const result = await submitWith('network-failure');
  try {
    assert.equal(result.state, 'error');
    assert.equal(result.text, 'Could not send your feedback. Please try again later.');
  } finally {
    await result.context.close();
  }
});

test('JavaScript disabled hides the form and leaves only the email fallback', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setContent(widgetHtml());

    assert.equal(
      await page.locator('[data-feedback-form]').evaluate(
        (form) => getComputedStyle(form).display,
      ),
      'none',
    );
    assert.equal(await page.locator('button[type="submit"]').isVisible(), false);
    assert.equal(await page.locator('[data-feedback-email]').isVisible(), true);
    assert.equal(
      await page.locator('[data-feedback-email]').getAttribute('href'),
      'mailto:feedback@example.invalid',
    );
  } finally {
    await context.close();
  }
});
