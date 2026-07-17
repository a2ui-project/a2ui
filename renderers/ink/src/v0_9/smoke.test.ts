/**
 * Copyright 2026 kokoro-ele
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from './catalog/basic/index.js';
import type {InkComponentImplementation} from './adapter.js';
import {stripMarkdown, weightProps, mapJustify, mapAlign} from './catalog/basic/utils.js';

type Messages = Parameters<MessageProcessor<InkComponentImplementation>['processMessages']>[0];

const examplesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../specification/v0_9_1/catalogs/basic/examples',
);

describe('@a2ui/ink examples', () => {
  const files = readdirSync(examplesDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  assert.ok(files.length > 0, 'expected example JSON files');

  for (const file of files) {
    it(`processes ${file}`, () => {
      const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf8'));
      const processor = new MessageProcessor<InkComponentImplementation>([basicCatalog]);
      processor.processMessages(structuredClone(raw.messages) as Messages);
      assert.ok(processor.model.surfacesMap.size >= 1, 'expected at least one surface');
      for (const surface of processor.model.surfacesMap.values()) {
        const root = surface.componentsModel.get('root');
        assert.ok(root, `${file}: missing root component`);
        assert.ok(
          surface.catalog.components.has(root.type),
          `${file}: catalog missing type ${root.type}`,
        );
      }
    });
  }

  it('registers full basic catalog component set', () => {
    const expected = [
      'Text',
      'Image',
      'Icon',
      'Video',
      'AudioPlayer',
      'Row',
      'Column',
      'List',
      'Card',
      'Tabs',
      'Divider',
      'Modal',
      'Button',
      'TextField',
      'CheckBox',
      'ChoicePicker',
      'Slider',
      'DateTimeInput',
    ];
    for (const name of expected) {
      assert.ok(basicCatalog.components.has(name), `missing ${name}`);
    }
  });
});

describe('@a2ui/ink terminal mapping utils', () => {
  it('strips common markdown markers for terminal fallback', () => {
    assert.equal(stripMarkdown('**bold** and *italic*'), 'bold and italic');
    assert.equal(stripMarkdown('`code` sample'), 'code sample');
    assert.equal(stripMarkdown('# Heading\nbody'), 'Heading\nbody');
    assert.equal(stripMarkdown('[link](https://example.com)'), 'link');
    assert.equal(stripMarkdown('plain text'), 'plain text');
  });

  it('maps weight to flex-grow semantics', () => {
    assert.deepEqual(weightProps(2), {flexGrow: 2});
    assert.deepEqual(weightProps(undefined), {});
  });

  it('maps justify/align enums to yoga values', () => {
    assert.equal(mapJustify('spaceBetween'), 'space-between');
    assert.equal(mapJustify(undefined), 'flex-start');
    assert.equal(mapAlign('center'), 'center');
    assert.equal(mapAlign(undefined), 'stretch');
  });
});
