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
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {checkDistLinks, parseHtmlDocument} from '../scripts/check-links.mjs';
import {findRepoRoot} from '../src/lib/spec-schemas.mjs';
import {resolveAstUrl} from '../src/plugins/remark-a2ui-includes.mjs';

function createTempDist(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2ui-site-check-links-'));
  t.after(() => {
    fs.rmSync(dir, {recursive: true, force: true});
  });

  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absPath), {recursive: true});
    fs.writeFileSync(absPath, content, 'utf8');
  }
  return dir;
}

test('passes valid intra-page #id, <a name>, cross-page ../page/#id, URL-encoded fragments, redirects, and assets', t => {
  const distDir = createTempDist(t, {
    'index.html': `<!doctype html>
      <html>
        <head>
          <link rel="icon" href="/preview/assets/favicon.svg">
          <link rel="stylesheet" href="/preview/_astro/main.css">
          <script type="module" src="/preview/_astro/app.js"></script>
        </head>
        <body>
          <h1 id="hero">Welcome</h1>
          <a name="legacy-target"></a>
          <a href="#">No-op</a>
          <a href="#top">Back to top</a>
          <a href="#hero">Hero</a>
          <a href="#legacy-target">Legacy</a>
          <a href="/preview/concepts/overview/#core-flow">Overview</a>
          <img src="/preview/assets/diagram.png" alt="Diagram">
        </body>
      </html>`,
    'concepts/glossary/index.html': `<!doctype html>
      <html>
        <body>
          <a href="../overview/#core-flow">Sibling relative</a>
          <a href="../overview/#caf%C3%A9-guide">Encoded UTF-8 anchor</a>
          <a href="../overview/#%ZZ-literal">Malformed percent literal</a>
        </body>
      </html>`,
    'concepts/overview/index.html': `<!doctype html>
      <html>
        <body>
          <h2 id="core-flow">Core Flow</h2>
          <h2 id="café-guide">Café Guide</h2>
          <h2 id="%ZZ-literal">Literal Percent</h2>
        </body>
      </html>`,
    'concepts/actions/index.html': `<!doctype html>
      <meta http-equiv="refresh" content="0;url=/preview/concepts/overview/#core-flow">
      <body><a href="/preview/concepts/overview/#core-flow">Redirecting</a></body>`,
    'assets/favicon.svg': '<svg></svg>',
    'assets/diagram.png': 'png',
    '_astro/main.css': 'body {}',
    '_astro/app.js': 'console.log(1);',
  });

  const result = checkDistLinks({distDir, base: '/preview/'});
  assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join('; ')}`);
  assert.equal(result.errors.length, 0);
});

test('fails on missing intra-page and cross-page #fragment IDs (including non-schema slash fragments)', t => {
  const distDir = createTempDist(t, {
    'index.html': `<!doctype html>
      <html>
        <body>
          <h1 id="existing">Heading</h1>
          <a href="#missing-local">Broken local</a>
          <a href="#existing/not-a-schema-pointer">Slash should not match prefix</a>
          <a href="/preview/other/#missing-remote">Broken cross-page</a>
        </body>
      </html>`,
    'other/index.html': `<!doctype html><html><body><h1 id="present">Other</h1></body></html>`,
  });

  const result = checkDistLinks({distDir, base: '/preview/'});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /#missing-local not found/);
  assert.match(result.errors[1], /#existing\/not-a-schema-pointer not found/);
  assert.match(result.errors[2], /#missing-remote not found/);
});

test('fails on missing target pages, broken redirects, and missing static assets', t => {
  const distDir = createTempDist(t, {
    'index.html': `<!doctype html>
      <html>
        <body>
          <a href="/preview/does-not-exist/">Missing page</a>
          <a href="/preview/also-missing/#section">Missing page with hash</a>
          <img src="/preview/assets/missing.png" alt="Missing asset">
        </body>
      </html>`,
    'old/index.html': `<!doctype html>
      <meta http-equiv="refresh" content="0;url=/preview/gone/">`,
  });

  const result = checkDistLinks({distDir, base: '/preview/'});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
  assert.match(result.errors[0], /target "\/does-not-exist\/" does not exist/);
  assert.match(result.errors[1], /target "\/also-missing\/" does not exist/);
  assert.match(result.errors[2], /target "\/assets\/missing\.png" does not exist/);
  assert.match(result.errors[3], /target "\/gone\/" does not exist/);
});

test('flags root-relative, redirect, and excessive relative links that escape ASTRO_BASE', t => {
  const distDir = createTempDist(t, {
    'index.html': `<!doctype html>
      <html>
        <body>
          <a href="/concepts/overview/">Escapes /preview/</a>
        </body>
      </html>`,
    'concepts/overview/index.html': `<!doctype html>
      <html>
        <body>
          <a href="../../../escaped/">Climbs above /preview/</a>
        </body>
      </html>`,
    'redirect/index.html': `<!doctype html>
      <meta http-equiv="refresh" content="0;url=/concepts/overview/">`,
  });

  const result = checkDistLinks({distDir, base: '/preview/'});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
  for (const err of result.errors) {
    assert.match(err, /escapes ASTRO_BASE "\/preview\/"/);
  }
});

test('ignores IDs and hrefs inside <template>, <script>, <style>, HTML comments, and code text nodes', t => {
  const html = `<!doctype html>
    <html>
      <head>
        <template id="theme-icons">
          <span id="ghost-template-id"></span>
          <a href="/broken-in-template/">Ignored</a>
        </template>
        <style>#fake-css { content: "id='css-id'"; }</style>
        <script>
          const tpl = '<div id="ghost-script-id"><a href="/broken-in-script/">x</a></div>';
        </script>
      </head>
      <body>
        <!-- <h2 id="commented-out"></h2> <a href="/broken-in-comment/"></a> -->
        <pre><code>&lt;a href="/broken-in-code/" id="code-id"&gt;snippet href="/also-text"&lt;/a&gt;</code></pre>
        <a href="#ghost-template-id">Should fail</a>
        <a href="#ghost-script-id">Should also fail</a>
        <a href="#commented-out">Commented ID should fail</a>
      </body>
    </html>`;

  const parsed = parseHtmlDocument(html);
  assert.equal(parsed.ids.size, 0);
  assert.equal(parsed.references.length, 3);

  const distDir = createTempDist(t, {'index.html': html});
  const result = checkDistLinks({distDir, base: ''});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3);
});

test('validates Schema Explorer and Catalog Guide JSON pointer fragments against canonical schemas', t => {
  const repoRoot = findRepoRoot();
  const distDir = createTempDist(t, {
    'index.html': `<!doctype html>
      <html>
        <body>
          <a href="/preview/specification/v1.0/schemas/#agent_to_renderer.json/$defs/CreateSurfaceMessage">Valid pointer</a>
          <a href="/preview/guides/mcp-catalog/#mcp_catalog.json/functions/callMcpTool">Valid MCP pointer</a>
          <a href="/preview/specification/v1.0/schemas/#agent_to_renderer.json/$defs/NonExistentType">Broken pointer</a>
          <a href="/preview/specification/v1.0/schemas/#mcp_catalog.json">Wrong host route</a>
        </body>
      </html>`,
    'specification/v1.0/schemas/index.html': `<!doctype html>
      <html>
        <body>
          <h2 id="agent_to_renderer.json">agent_to_renderer.json</h2>
          <h2 id="mcp_catalog.json">mcp_catalog.json</h2>
        </body>
      </html>`,
    'guides/mcp-catalog/index.html': `<!doctype html>
      <html>
        <body>
          <h2 id="mcp_catalog.json">mcp_catalog.json</h2>
        </body>
      </html>`,
  });

  const result = checkDistLinks({distDir, base: '/preview/', repoRoot});
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Broken schema JSON pointer "\$defs\/NonExistentType"/);
  assert.match(result.errors[1], /Schema "mcp_catalog\.json" .* is not hosted on/);
});

test('resolveAstUrl resolves Starlight URL-relative links, explicit .mdx file links, and spec includes', () => {
  const repoRoot = findRepoRoot();
  const glossaryMdx = path.join(repoRoot, 'docs/site/src/content/docs/concepts/glossary.mdx');
  const specWrapperMd = path.join(
    repoRoot,
    'docs/site/src/content/docs/specification/v1.0-a2ui.md',
  );
  const canonicalSpecMd = path.join(repoRoot, 'specification/v1_0/docs/a2ui_protocol.md');

  // Starlight URL-relative sibling and cross-section links inside src/content/docs/
  assert.equal(
    resolveAstUrl('../overview/', glossaryMdx, {base: '/preview/'}),
    '/preview/concepts/overview/',
  );
  assert.equal(
    resolveAstUrl('../catalogs/#the-basic-catalog', glossaryMdx, {base: '/preview/'}),
    '/preview/concepts/catalogs/#the-basic-catalog',
  );
  assert.equal(
    resolveAstUrl('../../specification/v1.0-a2ui/#functions', glossaryMdx, {base: '/preview/'}),
    '/preview/specification/v1.0-a2ui/#functions',
  );
  assert.equal(resolveAstUrl('../overview/', glossaryMdx, {base: ''}), '/concepts/overview/');

  // Explicit .mdx file link reading custom frontmatter slug
  assert.equal(
    resolveAstUrl('./v1.0-schemas.mdx', specWrapperMd, {base: '/preview/'}),
    '/preview/specification/v1.0/schemas/',
  );

  // Canonical included specification file links
  assert.equal(
    resolveAstUrl('../json/agent_to_renderer.json#/$defs/CreateSurfaceMessage', canonicalSpecMd, {
      base: '/preview/',
    }),
    '/preview/specification/v1.0/schemas/#agent_to_renderer.json/$defs/CreateSurfaceMessage',
  );
});
