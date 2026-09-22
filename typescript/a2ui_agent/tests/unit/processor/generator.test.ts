/**
 * @license
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

import {describe, test, expect} from 'vitest';
import {A2uiGenerator} from '../../../src/processor/generator.js';
import {CatalogConfig} from '../../../src/processor/catalog_config.js';
import {basicCatalog} from '../../../src/types.js';
import {A2uiCatalogError} from '../../../src/errors.js';
import {V10RendererCapabilities} from '../../../src/internal/web_core.js';

describe('A2uiGenerator', () => {
  const mockCapabilities: V10RendererCapabilities = {
    supportedCatalogIds: [basicCatalog().id],
  };

  test('successfully creates a processor when examples only use supported components', () => {
    const config = new CatalogConfig(basicCatalog());

    // Using 'Text' component which exists in basic catalog
    const examples = {
      'test_turn': [
        {
          version: 'v1.0' as const,
          updateComponents: {
            surfaceId: 's1',
            components: [
              {
                id: 'comp_1',
                component: 'Text',
                text: 'hello',
              },
            ],
          },
        },
      ],
    };

    const generator = new A2uiGenerator([config], examples);
    const processor = generator.createProcessor(mockCapabilities);

    expect(processor).toBeDefined();
    expect(processor.activeCatalogs[0].id).toBe(basicCatalog().id);
  });

  test('throws when an example uses a component not supported by the catalog', () => {
    const config = new CatalogConfig(basicCatalog());

    // Using a fake component 'MagicUnicorn'
    const examples = {
      'test_turn': [
        {
          version: 'v1.0' as const,
          createSurface: {
            surfaceId: 's1',
            catalogId: basicCatalog().id,
            components: [
              {
                id: 'comp_1',
                component: 'MagicUnicorn',
              },
            ],
          },
        },
      ],
    };

    const generator = new A2uiGenerator([config], examples);

    expect(() => generator.createProcessor(mockCapabilities)).toThrow(A2uiCatalogError);
    expect(() => generator.createProcessor(mockCapabilities)).toThrow(/MagicUnicorn/);
  });
});
