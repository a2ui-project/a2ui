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
import {describe, it} from 'node:test';

import {escapeInlineScript, findExternalReferences, renderAppHtml} from './html.js';

describe('renderAppHtml', () => {
  it('escapes the title and leaves out an empty stylesheet', () => {
    const html = renderAppHtml({title: 'Sales <Q1> & Q2', script: 'run()', style: ''});

    assert.match(html, /<title>Sales &lt;Q1&gt; &amp; Q2<\/title>/);
    assert.doesNotMatch(html, /<style>/);
    assert.match(html, /<script type="module">run\(\)<\/script>/);
  });

  it('keeps a stylesheet from closing its style element', () => {
    const html = renderAppHtml({title: 'App', script: '', style: 'a::after{content:"</style>"}'});

    assert.match(html, /<style>a::after\{content:"<\\\/style>"\}<\/style>/);
  });
});

describe('escapeInlineScript', () => {
  it('escapes closing script tags in any case and HTML comment openers', () => {
    assert.equal(
      escapeInlineScript('a="</script>";b="</SCRIPT >";c=/<!--x/'),
      'a="<\\/script>";b="<\\/SCRIPT >";c=/\\x3C!--x/',
    );
  });

  it('keeps the meaning of string and regular expression literals', () => {
    const source = 'globalThis.result=["</script>","<!--",/<\\/script>/u.source,`</Script>`]';

    const escaped = escapeInlineScript(source);

    assert.doesNotMatch(escaped, /<\/script|<!--/i);
    const scope: {result?: unknown} = {};
    new Function('globalThis', escaped)(scope);
    assert.deepEqual(scope.result, ['</script>', '<!--', '<\\/script>', '</Script>']);
  });
});

describe('findExternalReferences', () => {
  it('finds script, stylesheet and media references that load from the network', () => {
    const html = [
      '<script src="https://cdn.example.com/lib.js"></script>',
      "<link rel=stylesheet href='//fonts.example.com/font.css'>",
      '<img alt="" src="http://example.com/a.png">',
    ].join('');

    assert.deepEqual(findExternalReferences(html), [
      '<script src="https://cdn.example.com/lib.js',
      "<link rel=stylesheet href='//fonts.example.com/font.css",
      '<img alt="" src="http://example.com/a.png',
    ]);
  });

  it('finds remote imports in scripts and stylesheets', () => {
    const html = [
      'import("https://cdn.example.com/a.js");',
      'import {b} from "https://cdn.example.com/b.js";',
      '@import url("https://fonts.example.com/c.css");',
      '@import "https://fonts.example.com/d.css";',
      '.e{background:url(https://example.com/e.png)}',
    ].join('\n');

    assert.deepEqual(findExternalReferences(html), [
      'import("https://cdn.example.com/a.js',
      'from "https://cdn.example.com/b.js',
      '@import "https://fonts.example.com/d.css',
      'url("https://fonts.example.com/c.css',
      'url(https://example.com/e.png',
    ]);
  });

  it('ignores URLs the browser does not load', () => {
    const html = [
      'const id="https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";',
      '<a href="https://a2ui.org">A2UI</a>',
      '.e{background:url(data:image/png;base64,AAAA)}',
      'import("./local.js")',
    ].join('\n');

    assert.deepEqual(findExternalReferences(html), []);
  });
});
