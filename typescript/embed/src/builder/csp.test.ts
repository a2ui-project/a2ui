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
import {readFile} from 'node:fs/promises';
import {after, afterEach, before, beforeEach, describe, it} from 'node:test';

import {chromium, type Browser} from 'playwright';

import {buildApp} from './build.js';
import {createFixtureProject, type FixtureProject} from './testing/fixture_project.js';

/**
 * The policy MCP Apps hosts apply to an app resource that declares no `_meta.ui.csp`: nothing
 * loads from the network, and only inline scripts, inline styles and data or blob media run.
 */
const DEFAULT_MCP_APPS_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
].join('; ');

const APP_URL = 'https://app.test/';

// Page scripts are strings: the test project has no DOM types.
const RECORD_VIOLATIONS = `
  globalThis.violations = [];
  document.addEventListener('securitypolicyviolation', event => {
    violations.push(event.violatedDirective + ' ' + event.blockedURI);
  });`;
const READ_RESULT = `({
  root: {...document.getElementById('a2ui-root').dataset},
  violations: globalThis.violations,
})`;

describe('built app under the default MCP Apps CSP', () => {
  let browser: Browser;
  let project: FixtureProject;

  before(async () => {
    browser = await chromium.launch();
  });

  after(() => browser.close());

  beforeEach(async () => {
    project = await createFixtureProject();
    await project.write({
      'a2ui-embed.config.ts': `
import {basicCatalog, defineConfig} from '@a2ui/embed/build';
export default defineConfig({catalogs: [basicCatalog], output: 'app.html'});
`,
    });
  });

  afterEach(() => project.remove());

  /** Loads the built app with the CSP header and returns its root element's data and violations. */
  async function loadApp(): Promise<{root: Record<string, string>; violations: string[]}> {
    const {htmlPath} = await buildApp({cwd: project.dir, runtimeModule: project.runtime});
    const html = await readFile(htmlPath, 'utf8');
    const page = await browser.newPage();
    try {
      await page.addInitScript({content: RECORD_VIOLATIONS});
      await page.route(APP_URL, route =>
        route.fulfill({
          contentType: 'text/html',
          headers: {'content-security-policy': DEFAULT_MCP_APPS_CSP},
          body: html,
        }),
      );
      await page.goto(APP_URL);
      await page.waitForFunction(`${READ_RESULT}.root.started || ${READ_RESULT}.violations.length`);
      return (await page.evaluate(READ_RESULT)) as {
        root: Record<string, string>;
        violations: string[];
      };
    } finally {
      await page.close();
    }
  }

  it('runs the bundled catalogs and runtime without a violation', async () => {
    const {root, violations} = await loadApp();

    assert.deepEqual(violations, []);
    assert.equal(root.started, 'true');
    assert.equal(root.catalogs, 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json');
    assert.equal(root.marker, '</script><!-- end -->');
  });

  it('reports a runtime that needs eval', async () => {
    await project.write({
      'runtime.mjs': "export function startEmbedApp() { new Function('return 1')(); }",
    });

    const {root, violations} = await loadApp();

    assert.equal(root.started, undefined);
    assert.deepEqual(violations, ['script-src eval']);
  });
});
