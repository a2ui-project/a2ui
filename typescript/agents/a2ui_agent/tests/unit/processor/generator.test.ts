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

import {describe, expect, test} from 'vitest';

import {A2uiCatalogError, A2uiValidationError} from '../../../src/errors.js';
import {DirectJsonFormatFactory} from '../../../src/inference-formats/direct-json/format.js';
import {V10RendererCapabilities} from '../../../src/internal/web-core.js';
import {CatalogConfig} from '../../../src/processor/catalog-config.js';
import {InMemoryCatalogProvider} from '../../../src/processor/catalog-providers.js';
import {A2uiGenerator} from '../../../src/processor/generator.js';
import {RendererState} from '../../../src/utils/renderer-state.js';
import {loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const basicCatalogV10 = loadBasicCatalog('1.0');

describe('A2uiGenerator', () => {
  const mockCapabilities: V10RendererCapabilities = {
    supportedCatalogIds: [basicCatalogV10.id],
  };

  test('defaults to the Express format and supports overriding with DirectJsonFormatFactory', () => {
    const config = new CatalogConfig(basicCatalogV10);
    const generator = new A2uiGenerator([config]);

    const expressProcessor = generator.createProcessor(mockCapabilities);
    expect(expressProcessor.promptSnippet).toContain('<a2ui>');
    expect(expressProcessor.promptSnippet).toContain('Text(');

    const directJsonProcessor = generator.createProcessor(
      mockCapabilities,
      new DirectJsonFormatFactory(),
    );
    expect(directJsonProcessor.promptSnippet).toContain('---BEGIN A2UI JSON SCHEMA---');
  });

  test('successfully creates a processor when examples only use supported components', () => {
    const config = new CatalogConfig(basicCatalogV10);

    // Using 'Text' component which exists in basic catalog
    const examples = {
      'test_turn': [
        {
          version: '1.0' as const,
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
    expect(processor.activeCatalogs[0].id).toBe(basicCatalogV10.id);
  });

  test('throws when an example uses a component not supported by the catalog', () => {
    const config = new CatalogConfig(basicCatalogV10);

    // Using a fake component 'MagicUnicorn'
    const examples = {
      'test_turn': [
        {
          version: '1.0' as const,
          createSurface: {
            surfaceId: 's1',
            catalogId: basicCatalogV10.id,
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

    expect(() => generator.createProcessor(mockCapabilities)).toThrow(A2uiValidationError);
    expect(() => generator.createProcessor(mockCapabilities)).toThrow(/MagicUnicorn/);
  });

  test('throws a catalog error when capabilities are missing', () => {
    const generator = new A2uiGenerator([new CatalogConfig(basicCatalogV10)]);
    const missing = undefined as unknown as V10RendererCapabilities;

    expect(() => generator.createProcessor(missing)).toThrow(A2uiCatalogError);
    expect(() => generator.createProcessor(missing)).toThrow(/renderer capabilities/);
  });

  test('checks an example that creates a surface in full', () => {
    const config = new CatalogConfig(basicCatalogV10);
    const examples = {
      'dangling_turn': [
        {
          version: '1.0' as const,
          createSurface: {
            surfaceId: 's1',
            catalogId: basicCatalogV10.id,
            components: [{id: 'root', component: 'Column', children: ['missing']}],
          },
        },
      ],
    };
    const generator = new A2uiGenerator([config], examples);

    expect(() => generator.createProcessor(mockCapabilities)).toThrow(A2uiValidationError);
    expect(() => generator.createProcessor(mockCapabilities)).toThrow(
      /Example 'dangling_turn' is invalid.*Dangling reference 'missing'/,
    );
  });

  test('throws a validation error when an example message is not an object', () => {
    const config = new CatalogConfig(basicCatalogV10);
    // Examples loaded from JSON bypass the type, so a null entry can reach the generator.
    const examples = {'broken_turn': [null]} as unknown as ConstructorParameters<
      typeof A2uiGenerator
    >[1];
    const generator = new A2uiGenerator([config], examples);

    expect(() => generator.createProcessor(mockCapabilities)).toThrow(A2uiValidationError);
    expect(() => generator.createProcessor(mockCapabilities)).toThrow(/broken_turn/);
  });

  test('binds the state to the processor', () => {
    const generator = new A2uiGenerator([new CatalogConfig(basicCatalogV10)]);
    const state = generator.createProcessor(mockCapabilities).createState();

    const processor = generator.createProcessor(mockCapabilities, undefined, {state});

    expect(processor.state).toBe(state);
  });

  test('rejects a state for other catalogs', () => {
    const generator = new A2uiGenerator([new CatalogConfig(basicCatalogV10)]);
    const other = new RendererState([
      new InMemoryCatalogProvider({catalogId: 'other', components: {}}, '1.0').load(),
    ]);

    expect(() => generator.createProcessor(mockCapabilities, undefined, {state: other})).toThrow(
      A2uiCatalogError,
    );
    expect(() => generator.createProcessor(mockCapabilities, undefined, {state: other})).toThrow(
      /active catalogs/,
    );
  });

  test('accepts version-keyed renderer capabilities and rejects capabilities lacking the catalogs version', () => {
    const generator = new A2uiGenerator([new CatalogConfig(basicCatalogV10)]);

    const processor = generator.createProcessor({
      '1.0': {supportedCatalogIds: [basicCatalogV10.id]},
    });
    expect(processor.activeCatalogs[0].id).toBe(basicCatalogV10.id);

    expect(() =>
      generator.createProcessor({
        'v0.9': {supportedCatalogIds: [basicCatalogV10.id]},
      }),
    ).toThrow(A2uiValidationError);
  });
});
