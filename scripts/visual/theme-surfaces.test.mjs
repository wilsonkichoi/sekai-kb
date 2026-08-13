#!/usr/bin/env node
/**
 * theme-surfaces.test.mjs — browser-backed dark/light theme regression guard
 *
 * Asserts computed background and text colors on named surfaces in both themes.
 * Fails when a surface renders a light-only color in dark mode, or a dark-only
 * color in light mode — the two directions of one defect: a token that resolved
 * to a single theme's value.
 *
 * Usage:
 *   node scripts/visual/theme-surfaces.test.mjs
 *
 * Starts its own preview server from ./dist, so `npm run build` must have run.
 * If BASE_URL is set, uses an already-running server instead.
 *
 * Env:
 *   BASE_URL   override server URL (skips internal server start)
 */

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const distDir = resolve(repoRoot, 'dist');

let server = null;
let BASE_URL = process.env.BASE_URL || '';

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

async function startServer() {
  if (BASE_URL) return;
  if (!existsSync(distDir)) {
    console.error('dist/ not found. Run `npm run build` first.');
    process.exit(1);
  }
  const port = 4399;
  BASE_URL = `http://localhost:${port}`;
  server = createServer((req, res) => {
    let url = req.url.split('?')[0];
    if (url.endsWith('/')) url += 'index.html';
    if (!extname(url)) url += '/index.html';
    const filePath = join(distDir, url);
    try {
      const data = readFileSync(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((ok) => server.listen(port, ok));
}

function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
}

// Named surfaces: [route, selector, property, description]
// Each surface is checked in both light and dark themes.
const SURFACES = [
  // Home
  ['/', '.article-card', 'background-color', 'Home: article card bg'],
  ['/', '.article-card .article-card-title', 'color', 'Home: article card title'],
  ['/', '[aria-label="Quick navigation"] a', 'background-color', 'Home: reader door card'],
  ['/', '#cover-story section', 'background-color', 'Home: cover story section bg'],

  // Latest
  ['/latest/', '#latest-filters', 'background-color', 'Latest: filter bar bg'],
  ['/latest/', '.latest-chip', 'background-color', 'Latest: inactive chip bg'],

  // Dashboard
  ['/dashboard/', '.dashboard', 'background-color', 'Dashboard: page bg'],
  ['/dashboard/', '.vital-card', 'background-color', 'Dashboard: vital card bg'],

  // About
  ['/about/', '.vision-block', 'background-color', 'About: vision block bg'],
  ['/about/', '.guide-card', 'background-color', 'About: guide card bg'],
  ['/about/', '.faq-question', 'color', 'About: FAQ question text'],
  ['/about/', '.contact-card', 'background-color', 'About: contact card bg'],

  // Contribute
  ['/contribute/', '.how-card', 'background-color', 'Contribute: how-card bg'],
  ['/contribute/', '.path-card', 'background-color', 'Contribute: path card bg'],
  ['/contribute/', '.idea', 'background-color', 'Contribute: idea chip bg'],

  // Changelog
  ['/changelog/', '.commit-log-item', 'background-color', 'Changelog: commit card bg'],
  ['/changelog/', '#changelog-controls', 'background-color', 'Changelog: control bar bg'],

  // AI access. Every selector here renders on any instance: the two static paths are
  // always documented, so none of these rows can go quietly vacuous on a config with
  // the MCP or chat feature off (an absent element is skipped, not failed).
  ['/ai/', '.ai-card', 'background-color', 'AI access: path card bg'],
  ['/ai/', '.ai-card h2', 'color', 'AI access: path card heading'],
  ['/ai/', '.ai-note', 'color', 'AI access: ordering note text'],
  ['/ai/', '.ai-endpoints dd', 'color', 'AI access: endpoint description text'],
];

// These light-only colors are BANNED in dark mode. If any surface computes one
// of these in dark theme, the test fails.
const LIGHT_ONLY_COLORS = [
  'rgb(255, 255, 255)',       // #ffffff / white
  'rgb(248, 250, 252)',       // #f8fafc
  'rgb(249, 250, 251)',       // #f9fafb
  'rgb(250, 251, 252)',       // #fafbfc
  'rgb(241, 245, 249)',       // #f1f5f9
  'rgb(240, 249, 255)',       // #f0f9ff
];

// Banned dark-on-dark text colors in dark mode
const DARK_INK_COLORS = [
  'rgb(31, 41, 55)',          // #1f2937
  'rgb(14, 58, 92)',          // #0e3a5c
  'rgb(26, 26, 46)',          // #1a1a2e
  'rgb(30, 41, 59)',          // #1e293b
  'rgb(55, 65, 81)',          // #374151
];

/** [r, g, b, a] from any computed color, or null when it does not parse. */
function channels(color) {
  if (!color) return null;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function isLightOnlyBg(color) {
  if (!color) return false;
  if (LIGHT_ONLY_COLORS.includes(color)) return true;
  const parsed = channels(color);
  if (!parsed) return false;
  const [r, g, b] = parsed;
  // Any rgb where all channels > 230 is a light-only surface in dark mode
  if (r > 230 && g > 230 && b > 230) return true;
  return false;
}

function isDarkInk(color) {
  if (!color) return false;
  const parsed = channels(color);
  if (!parsed) return false;
  const [r, g, b] = parsed;
  // Any text color where all channels < 100 is dark-on-dark
  if (r < 100 && g < 100 && b < 100) return true;
  return DARK_INK_COLORS.includes(color);
}

// The light-mode mirror of the two heuristics above. A theme regression is symmetric:
// a token that resolved to only one theme's value shows up as a dark panel under dark
// text in LIGHT mode exactly as often as the reverse shows up in dark mode, and until
// these existed the suite could only see one direction of it.
//
// A fully transparent computed value is not a dark surface -- it is an element that
// inherits its background -- so alpha 0 is excluded before the channel test. Without
// that, every `rgba(0, 0, 0, 0)` would read as black.

function isDarkOnlyBg(color) {
  const parsed = channels(color);
  if (!parsed) return false;
  const [r, g, b, a] = parsed;
  if (a === 0) return false;
  return r < 60 && g < 60 && b < 60;
}

function isLightInk(color) {
  const parsed = channels(color);
  if (!parsed) return false;
  const [r, g, b, a] = parsed;
  if (a === 0) return false;
  return r > 200 && g > 200 && b > 200;
}

const HEURISTICS = { isLightOnlyBg, isDarkInk, isDarkOnlyBg, isLightInk };

function selfTest() {
  const planted = [
    ['isLightOnlyBg', 'rgb(255, 255, 255)', true],
    ['isLightOnlyBg', 'rgb(248, 250, 252)', true],
    ['isLightOnlyBg', 'rgb(235, 235, 235)', true],
    ['isLightOnlyBg', 'rgb(20, 20, 31)', false],
    ['isDarkInk', 'rgb(31, 41, 55)', true],
    ['isDarkInk', 'rgb(50, 60, 70)', true],
    ['isDarkInk', 'rgb(241, 245, 249)', false],
    ['isDarkOnlyBg', 'rgb(20, 20, 31)', true],
    ['isDarkOnlyBg', 'rgb(255, 255, 255)', false],
    ['isDarkOnlyBg', 'rgba(0, 0, 0, 0)', false],
    ['isLightInk', 'rgb(241, 245, 249)', true],
    ['isLightInk', 'rgb(31, 41, 55)', false],
    ['isLightInk', 'rgba(255, 255, 255, 0)', false],
  ];
  for (const [fn, input, expected] of planted) {
    const actual = HEURISTICS[fn](input);
    if (actual !== expected) {
      console.error(`NON-VACUITY FAIL: ${fn}(${input}) = ${actual}, expected ${expected}`);
      process.exit(1);
    }
  }
  console.log(`non-vacuity: heuristic self-test passed (${planted.length} planted values)`);
}

async function main() {
  selfTest();
  await startServer();
  const browser = await chromium.launch();
  const failures = [];
  let checked = 0;

  /** The computed value of one property on one surface, under one theme. */
  async function computed(url, theme, selector, property) {
    const page = await browser.newPage();
    try {
      // Set the theme via JS before navigation so styles apply from the start.
      await page.addInitScript((value) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.setAttribute('data-theme', value);
        });
      }, theme);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Belt and suspenders: the init script races DOMContentLoaded on a cached page.
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await page.waitForTimeout(200);
      return await page.evaluate(
        ({ sel, prop }) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return getComputedStyle(el).getPropertyValue(prop);
        },
        { sel: selector, prop: property },
      );
    } finally {
      await page.close();
    }
  }

  // Each surface is checked in BOTH themes: the two directions of the same regression.
  const THEMES = [
    {
      name: 'dark',
      bad: { 'background-color': [isLightOnlyBg, 'light-only surface'], color: [isDarkInk, 'dark-on-dark text'] },
    },
    {
      name: 'light',
      bad: { 'background-color': [isDarkOnlyBg, 'dark-only surface'], color: [isLightInk, 'light-on-light text'] },
    },
  ];

  for (const [route, selector, property, label] of SURFACES) {
    const url = `${BASE_URL}${route}`;
    for (const theme of THEMES) {
      const value = await computed(url, theme.name, selector, property);
      // Element not found on page - skip (may be data-dependent or feature-gated).
      if (value === null) continue;

      checked++;

      const [predicate, reason] = theme.bad[property];
      if (predicate(value)) {
        failures.push(`FAIL [${theme.name}] ${label}: ${property} = ${value} (${reason})`);
      }
    }
  }

  await browser.close();
  stopServer();

  console.log(
    `theme-surfaces: checked ${checked} surface/theme pairs across ${SURFACES.length} surfaces`,
  );

  if (failures.length > 0) {
    console.error('\n' + failures.join('\n'));
    console.error(`\n${failures.length} theme regression(s) found.`);
    process.exit(1);
  }

  console.log(
    '✅ theme-surfaces passed — no single-theme surfaces or unreadable text in either mode.',
  );
}

main().catch((err) => {
  stopServer();
  console.error('theme-surfaces: fatal error:', err.message);
  process.exit(1);
});
