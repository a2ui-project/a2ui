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
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, afterEach, before, beforeEach, describe, it} from 'node:test';

import {build as esbuild} from 'esbuild';
import {chromium, type Browser, type Frame, type Page} from 'playwright';

import {CONTRACT_VERSION} from '../contract/index.js';
import {build} from './build.js';
import {createFixtureProject, type FixtureProject} from './testing/fixture_project.js';

/**
 * End-to-end check of the published pipeline: `build()` bundles the real `@a2ui/embed/mcp` runtime
 * and the basic catalog, and a host built on the App SDK's `AppBridge` renders a tool result in it
 * under the default MCP Apps CSP. Needs the package's `dist/`, which `test:node` builds first.
 */

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The policy MCP Apps hosts apply to an app resource that declares no `_meta.ui.csp`. */
const DEFAULT_MCP_APPS_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
].join('; ');

const HOST_URL = 'https://host.test/';
const APP_URL = 'https://app.test/';

/** A host page script: it loads the app in an iframe and connects an `AppBridge` to it. */
const HOST_ENTRY = `
import {AppBridge, PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';

const iframe = document.createElement('iframe');
iframe.style.width = '600px';
iframe.src = ${JSON.stringify(APP_URL)};
document.body.append(iframe);

const bridge = new AppBridge(
  null,
  {name: 'e2e-host', version: '0.0.0'},
  {serverTools: {}, message: {text: {}}},
  {hostContext: {theme: 'light', displayMode: 'inline'}},
);
const sizes = [];
bridge.onsizechange = params => sizes.push(params);
const initialized = new Promise(resolve => {
  bridge.oninitialized = () => resolve();
});
globalThis.host = {
  sizes,
  ready: bridge
    .connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow))
    .then(() => initialized),
  sendToolResult: result => bridge.sendToolResult(result),
};
`;

const RECORD_VIOLATIONS = `
  globalThis.violations = [];
  document.addEventListener('securitypolicyviolation', event => {
    violations.push(event.violatedDirective + ' ' + event.blockedURI);
  });`;

interface PageGlobals {
  violations: string[];
  host?: {
    sizes: Array<{height?: number}>;
    ready: Promise<void>;
    sendToolResult(result: unknown): Promise<unknown>;
  };
}

/**
 * The text of the app's `<a2ui-surface>`, including the text inside shadow roots. It runs in the
 * page, so it declares no nested functions: tsx would wrap them in a helper the page lacks.
 */
function surfaceText(): string {
  const surface = document.querySelector('a2ui-surface');
  let text = '';
  const pending: Node[] = surface ? [surface] : [];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    if (node instanceof Element && node.shadowRoot) pending.push(node.shadowRoot);
    pending.push(...Array.from(node.childNodes));
  }
  return text;
}

/**
 * The markdown the surface rendered: the text of its `<strong>` and of its list items. Like
 * {@link surfaceText}, it walks shadow roots and declares no nested functions.
 */
function renderedMarkdown(): {strong: string | undefined; items: string[]} {
  const result: {strong: string | undefined; items: string[]} = {strong: undefined, items: []};
  const surface = document.querySelector('a2ui-surface');
  const pending: Node[] = surface ? [surface] : [];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node instanceof Element) {
      if (node.localName === 'strong') result.strong = node.textContent ?? '';
      if (node.localName === 'li') result.items.push(node.textContent ?? '');
      if (node.shadowRoot) pending.push(node.shadowRoot);
    }
    pending.push(...Array.from(node.childNodes));
  }
  return result;
}

/**
 * Polls `read` in `frame` until `accept` holds. Playwright's `waitForFunction` evaluates strings,
 * which the app's CSP blocks, while `evaluate` with a function is exempt.
 */
async function waitUntil<T>(
  frame: Frame,
  read: () => T,
  accept: (value: T) => boolean,
  description: string,
): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = (await frame.evaluate(read)) as T;
    if (accept(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(value)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';

const PAYLOAD = {
  contractVersion: CONTRACT_VERSION,
  messages: [
    {version: '1.0', createSurface: {surfaceId: 'report', catalogId: CATALOG_ID}},
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'report',
        components: [
          {id: 'root', component: 'Column', children: ['title', 'body']},
          {id: 'title', component: 'Text', text: 'Revenue'},
          {id: 'body', component: 'Text', text: 'Grew **12%** in March.\n\n- EMEA\n- APAC'},
        ],
      },
    },
  ],
};

describe('built app in an MCP Apps host', () => {
  let browser: Browser;
  let hostScript: string;
  let project: FixtureProject;
  let page: Page;

  before(async () => {
    browser = await chromium.launch();
    const result = await esbuild({
      stdin: {contents: HOST_ENTRY, resolveDir: PACKAGE_DIR, sourcefile: 'host.js'},
      bundle: true,
      format: 'esm',
      write: false,
      logLevel: 'silent',
    });
    hostScript = result.outputFiles[0].text;
  });

  after(() => browser.close());

  beforeEach(async () => {
    project = await createFixtureProject();
    await project.write({
      'a2ui-embed.config.ts': `
import {basicCatalog, defineConfig} from '@a2ui/embed/build';
export default defineConfig({catalogs: [basicCatalog], output: 'dist/app.html'});
`,
    });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
    await project.remove();
  });

  it('renders a tool result with markdown under the default CSP and reports its size', async () => {
    const {htmlPath, htmlBytes} = await build({cwd: project.dir});
    const appHtml = await readFile(htmlPath, 'utf8');
    console.log(`Built app: ${htmlBytes} bytes`);
    const warnings: string[] = [];
    page.on('console', message => {
      if (message.type() === 'warning') warnings.push(message.text());
    });

    await page.addInitScript({content: RECORD_VIOLATIONS});
    await page.route(HOST_URL, route =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><script type="module">${hostScript}</script></body></html>`,
      }),
    );
    await page.route(APP_URL, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: {'content-security-policy': DEFAULT_MCP_APPS_CSP},
        body: appHtml,
      }),
    );
    await page.goto(HOST_URL);
    const hostFrame = page.mainFrame();
    await waitUntil(
      hostFrame,
      () => (globalThis as unknown as PageGlobals).host !== undefined,
      Boolean,
      'the host',
    );
    await hostFrame.evaluate(() => (globalThis as unknown as PageGlobals).host!.ready);

    await hostFrame.evaluate(
      result => (globalThis as unknown as PageGlobals).host!.sendToolResult(result),
      {
        content: [{type: 'text', text: 'Revenue grew 12% in March.'}],
        structuredContent: {a2ui: PAYLOAD},
      },
    );

    const app = page.frame({url: APP_URL});
    assert.ok(app, 'the app frame');
    const text = await waitUntil(
      app,
      surfaceText,
      value => value.includes('APAC'),
      'the surface to render',
    );
    assert.match(text, /Revenue/);
    assert.deepEqual(await app.evaluate(renderedMarkdown), {
      strong: '12%',
      items: ['EMEA', 'APAC'],
    });
    assert.deepEqual(
      warnings.filter(warning => warning.includes('MarkdownDirective')),
      [],
    );
    await waitUntil(
      hostFrame,
      () => (globalThis as unknown as PageGlobals).host!.sizes,
      sizes => sizes.some(size => (size.height ?? 0) > 0),
      'a size-changed notification',
    );
    assert.deepEqual(
      await app.evaluate(() => (globalThis as unknown as PageGlobals).violations),
      [],
    );
    assert.deepEqual(
      await hostFrame.evaluate(() => (globalThis as unknown as PageGlobals).violations),
      [],
    );
  });
});
