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

import * as assert from 'node:assert';
import {describe, it} from 'node:test';
import {basicCatalog} from './catalog.js';
import {MessageProcessor} from '../processing/message-processor.js';

const CANONICAL_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const LEGACY_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

describe('basic catalog identity', () => {
  it('uses the canonical spec URL as its id', () => {
    assert.strictEqual(basicCatalog.id, CANONICAL_ID);
  });

  it('aliases the legacy non-canonical URL', () => {
    assert.deepStrictEqual(basicCatalog.aliases, [LEGACY_ID]);
  });

  it('creates a surface from a legacy createSurface message', () => {
    const processor = new MessageProcessor([basicCatalog]);

    processor.processMessages([
      {version: 'v0.9', createSurface: {surfaceId: 'legacy', catalogId: LEGACY_ID}},
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'legacy',
          components: [{id: 'root', component: 'Text', text: 'hello'}],
        },
      },
    ]);

    const surface = processor.model.getSurface('legacy');
    assert.strictEqual(surface?.catalog.id, CANONICAL_ID);
    assert.strictEqual(surface?.componentsModel.get('root')?.type, 'Text');
  });

  it('advertises only the canonical id to agents', () => {
    const caps = new MessageProcessor([basicCatalog]).getClientCapabilities() as any;

    assert.deepStrictEqual(caps['v0.9'].supportedCatalogIds, [CANONICAL_ID]);
  });
});
