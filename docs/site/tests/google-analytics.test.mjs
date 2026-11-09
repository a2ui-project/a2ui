/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  DEFAULT_GA_MEASUREMENT_ID,
  googleAnalytics,
  injectGoogleAnalyticsHead,
  onRequest,
} from '../src/plugins/google-analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
const EXPECTED_GA_ID = 'G-YX9TPV8DCC';

function walkFiles(dir, suffix, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, suffix, out);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

test('injectGoogleAnalyticsHead injects gtag.js into <head>, is idempotent, and skips redirects', () => {
  assert.equal(DEFAULT_GA_MEASUREMENT_ID, EXPECTED_GA_ID);

  const pageHtml = '<!doctype html><html><head><title>Test</title></head><body>Hi</body></html>';
  const injected = injectGoogleAnalyticsHead(pageHtml, EXPECTED_GA_ID);
  assert.match(
    injected,
    new RegExp(
      `<script async src="https://www\\.googletagmanager\\.com/gtag/js\\?id=${EXPECTED_GA_ID}"></script>`,
    ),
  );
  assert.match(injected, new RegExp(`gtag\\('config', '${EXPECTED_GA_ID}'\\);`));
  assert.ok(injected.indexOf('googletagmanager.com') < injected.indexOf('</head>'));

  // Idempotent on a second pass
  assert.equal(injectGoogleAnalyticsHead(injected, EXPECTED_GA_ID), injected);

  // Skips static redirect stubs
  const redirectStub =
    '<!doctype html><meta http-equiv="refresh" content="0;url=/quickstart/"><head></head>';
  assert.equal(injectGoogleAnalyticsHead(redirectStub, EXPECTED_GA_ID), redirectStub);

  // Rejects malformed measurement IDs
  assert.throws(() => googleAnalytics('invalid-id'), /Invalid Google Analytics measurement ID/);
});

test('onRequest middleware injects analytics on text/html responses and ignores non-HTML responses', async () => {
  const htmlResponse = await onRequest({}, async () => {
    return new Response(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
      {
        status: 200,
        headers: {'content-type': 'text/html; charset=utf-8', 'content-length': '76'},
      },
    );
  });
  assert.equal(htmlResponse.headers.get('content-length'), null);
  const body = await htmlResponse.text();
  assert.match(body, new RegExp(`googletagmanager\\.com/gtag/js\\?id=${EXPECTED_GA_ID}`));

  const jsonPayload = JSON.stringify({ok: true});
  const jsonResponse = await onRequest({}, async () => {
    return new Response(jsonPayload, {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  });
  assert.equal(await jsonResponse.text(), jsonPayload);
});

test('astro.config.mjs registers global googleAnalytics integration with G-YX9TPV8DCC', () => {
  const astroConfig = fs.readFileSync(path.join(siteRoot, 'astro.config.mjs'), 'utf8');
  assert.match(astroConfig, new RegExp(`googleAnalytics\\(\\s*['"]${EXPECTED_GA_ID}['"]\\s*\\)`));
});

test('all built non-redirect HTML pages in dist/ contain Google Analytics tag when built', t => {
  const distDir = path.join(siteRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    t.skip('dist/ has not been built yet');
    return;
  }

  const htmlFiles = walkFiles(distDir, '.html');
  assert.ok(htmlFiles.length > 0, 'Expected built HTML files inside dist/');

  let checkedCount = 0;
  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    if (/<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?/i.test(html)) {
      continue;
    }

    checkedCount++;
    const relHtml = path.relative(distDir, htmlFile);
    const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
    assert.ok(headMatch, `${relHtml} is missing <head>`);
    assert.match(
      headMatch[1],
      new RegExp(`https://www\\.googletagmanager\\.com/gtag/js\\?id=${EXPECTED_GA_ID}`),
      `${relHtml} is missing gtag.js loader in <head>`,
    );
    assert.match(
      headMatch[1],
      new RegExp(`gtag\\(['"]config['"],\\s*['"]${EXPECTED_GA_ID}['"]\\)`),
      `${relHtml} is missing gtag('config', '${EXPECTED_GA_ID}') in <head>`,
    );
  }

  assert.ok(checkedCount > 0, 'Expected at least one non-redirect HTML page in dist/');
});
