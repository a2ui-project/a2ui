/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {describe, it} from 'node:test';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const jsdom = new JSDOM('');
(globalThis as any).window = jsdom.window;
(globalThis as any).document = jsdom.window.document;

import * as yaml from 'js-yaml';
import {renderMarkdown} from './markdown.js';

interface MarkdownSubsetCase {
  name: string;
  description?: string;
  action: string;
  markdown: string;
  expectVisibleText?: string;
  expectPresent?: Array<'strong' | 'emphasis' | 'heading' | 'list_item' | 'code'>;
  expectAbsent?: Array<'html' | 'image' | 'link'>;
}

interface ManifestRecord {
  harness: string;
  suite: string;
  case: string;
  status: 'passed' | 'failed' | 'skipped' | 'xfailed';
  reason?: string;
}

const KNOWN_GAPS: Record<string, string> = {};

function writeManifestRecord(rec: ManifestRecord): void {
  const manifestDir = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
  if (!manifestDir) {
    return;
  }
  fs.mkdirSync(manifestDir, {recursive: true});
  const filePath = path.join(manifestDir, `${rec.harness}-${process.pid}.jsonl`);
  const payload: Record<string, string> = {
    harness: rec.harness,
    suite: rec.suite.replaceAll('\\', '/'),
    case: rec.case,
    status: rec.status,
  };
  if (rec.reason) {
    payload.reason = rec.reason;
  }
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

describe('Markdown Subset Conformance (adapter/markdown_subset.yaml)', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const suitePath = path.resolve(
    __dirname,
    '../../../../../conformance/adapter/markdown_subset.yaml',
  );
  const suiteRel = 'adapter/markdown_subset.yaml';
  const yamlContent = fs.readFileSync(suitePath, 'utf8');
  const cases = yaml.load(yamlContent) as MarkdownSubsetCase[];

  for (const c of cases) {
    it(c.name, async t => {
      const gapReason = KNOWN_GAPS[c.name];
      if (gapReason) {
        writeManifestRecord({
          harness: 'markdown-it',
          suite: suiteRel,
          case: c.name,
          status: 'xfailed',
          reason: gapReason,
        });
        t.skip(`Known gap: ${gapReason}`);
        return;
      }

      try {
        const html = await renderMarkdown(c.markdown);
        const dom = new JSDOM(html);
        const doc = dom.window.document;
        const body = doc.body;

        if (c.expectVisibleText !== undefined) {
          const visible = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
          assert.equal(visible, c.expectVisibleText.replace(/\s+/g, ' ').trim());
        }

        for (const present of c.expectPresent ?? []) {
          switch (present) {
            case 'strong':
              assert.ok(
                body.querySelector('strong, b'),
                `Expected strong/bold element for case ${c.name}`,
              );
              break;
            case 'emphasis':
              assert.ok(
                body.querySelector('em, i'),
                `Expected emphasis element for case ${c.name}`,
              );
              break;
            case 'heading':
              assert.ok(
                body.querySelector('h1, h2, h3, h4, h5, h6'),
                `Expected heading element for case ${c.name}`,
              );
              break;
            case 'list_item':
              assert.ok(body.querySelector('li'), `Expected list_item element for case ${c.name}`);
              break;
            case 'code':
              assert.ok(body.querySelector('code'), `Expected code element for case ${c.name}`);
              break;
          }
        }

        for (const absent of c.expectAbsent ?? []) {
          switch (absent) {
            case 'html':
              assert.equal(
                body.querySelectorAll('span, script, iframe').length,
                0,
                `Expected no raw HTML elements for case ${c.name}`,
              );
              break;
            case 'image':
              assert.equal(
                body.querySelectorAll('img').length,
                0,
                `Expected no image element for case ${c.name}`,
              );
              break;
            case 'link':
              assert.equal(
                body.querySelectorAll('a').length,
                0,
                `Expected no link element for case ${c.name}`,
              );
              break;
          }
        }

        writeManifestRecord({
          harness: 'markdown-it',
          suite: suiteRel,
          case: c.name,
          status: 'passed',
        });
      } catch (err) {
        writeManifestRecord({
          harness: 'markdown-it',
          suite: suiteRel,
          case: c.name,
          status: 'failed',
          reason: String(err),
        });
        throw err;
      }
    });
  }
});
