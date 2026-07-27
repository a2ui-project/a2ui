/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it} from 'node:test';
import {MessageProcessor, GenericBinder, ComponentContext} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '../catalogs/basic/index.js';
import {TextApi} from '@a2ui/web_core/v0_9/basic_catalog';
import fs from 'fs';
import path from 'path';

/**
 * These tests verify that:
 * - The basic catalog is correctly defined and can be used to process
 *   the examples from web_core.
 */
describe('v0.9 Basic Catalog Examples', () => {
  const examplesDir = path.resolve(
    process.cwd(),
    '../../specification/v0_9/catalogs/basic/examples',
  );

  const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    it(`should successfully process ${file}`, async () => {
      const content = fs.readFileSync(path.join(examplesDir, file), 'utf-8');
      const data = JSON.parse(content);
      const messages = Array.isArray(data) ? data : data.messages || [];

      let surfaceId = file.replace('.json', '');
      const createMsg = messages.find((m: any) => m.createSurface);
      if (createMsg) {
        surfaceId = createMsg.createSurface.surfaceId;
      } else {
        messages.unshift({
          version: 'v0.9',
          createSurface: {
            surfaceId,
            catalogId: basicCatalog.id,
          },
        });
      }

      const processor = new MessageProcessor([basicCatalog]);

      processor.processMessages(messages);

      const surface = processor.model.getSurface(surfaceId);
      assert.ok(surface, `Surface ${surfaceId} should exist`);

      const rootNode = surface.componentsModel.get('root');
      assert.ok(rootNode, 'Surface should have a root component');

      if (file.includes('formatted-text')) {
        const textNode = surface.componentsModel.get('result_text');
        assert.ok(textNode);

        const context = new ComponentContext(surface, 'result_text');
        const binder = new GenericBinder<any>(context, TextApi.schema);
        const sub = binder.subscribe(() => {}); // Force connection

        // Wait a microtask to let initial resolution finish
        await new Promise(r => setTimeout(r, 0));
        assert.strictEqual(binder.snapshot.text, 'You typed: ');

        // Set value in data model
        surface.dataModel.set('/inputValue', 'hello world');

        await new Promise(r => setTimeout(r, 0));
        assert.strictEqual(binder.snapshot.text, 'You typed: hello world');

        sub.unsubscribe();
        binder.dispose();
      }
    });
  }
});

// TODO: Replace this by actual 0.9.1 tests by loading from the examples.
// Note that this cannot be done now, because the v0_9_1 examples have the wrong
// "version" field ("0.9" instead of "0.9.1").
describe('v0.9.1 Basic Catalog Example Processing', () => {
  it('should successfully process v0.9.1 messages using basic catalog', () => {
    const processor = new MessageProcessor([basicCatalog]);
    const messages = [
      {
        version: 'v0.9.1' as const,
        createSurface: {
          surfaceId: 'v091-surface',
          catalogId: basicCatalog.id,
        },
      },
      {
        version: 'v0.9.1' as const,
        updateComponents: {
          surfaceId: 'v091-surface',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello from v0.9.1 in lit test!',
            },
          ],
        },
      },
    ];

    processor.processMessages(messages);
    const surface = processor.model.getSurface('v091-surface');
    assert.ok(surface, 'Surface v091-surface should exist');

    const rootNode = surface.componentsModel.get('root');
    assert.ok(rootNode, 'Surface should have a root component');
    assert.strictEqual(rootNode.type, 'Text');
  });
});
