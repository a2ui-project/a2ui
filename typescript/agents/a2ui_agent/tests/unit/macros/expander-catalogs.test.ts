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

import {describe, expect, it} from 'vitest';

import {
  A2uiCatalogError,
  A2uiValidationError,
  defineMacro,
  MacroExpander,
  param,
} from '../../../src/index.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const Badge = defineMacro({
  name: 'Badge',
  description: 'A badge.',
  parameters: {
    label: param.string({description: 'The label.'}),
    tone: param.string({enum: ['info', 'warning'], default: 'info'}),
    weight: param.number({required: false}),
  },
  render: ({label}) => ({component: 'Text', text: label}),
});

describe('MacroExpander catalogs', () => {
  it('exports the macros as a standalone v1.0 catalog', () => {
    const catalog = new MacroExpander([Badge]).toCatalog();

    expect(catalog.toJson()).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      protocolVersion: '1.0',
      catalogId: 'https://a2ui.org/catalogs/macros',
      title: 'A2UI Macros Catalog',
      description: 'Standalone catalog of high-level A2UI macro components.',
      components: {
        Badge: {
          type: 'object',
          properties: {
            component: {const: 'Badge'},
            label: {type: 'string', description: 'The label.'},
            tone: {type: 'string', enum: ['info', 'warning']},
            weight: {type: 'number'},
          },
          required: ['component', 'label'],
          description: 'A badge.',
        },
      },
      $defs: {
        anyComponent: {
          oneOf: [{$ref: '#/components/Badge'}],
          discriminator: {propertyName: 'component'},
        },
        anyFunction: {not: {}},
      },
    });
  });

  it('keeps only the passthrough components next to the macros', () => {
    const expander = new MacroExpander([Badge], {passthroughComponents: ['Text', 'Row']});

    const catalog = expander.transformToInferenceCatalog(loadBasicCatalog('1.0'));

    expect([...catalog.components.keys()].sort()).toEqual(['Badge', 'Row', 'Text']);
    expect(catalog.id).toBe(BASIC_CATALOG_IDS['1.0']);
  });

  it('lets a macro take the name of a component that passthrough prunes', () => {
    const Text = defineMacro({name: 'Text', render: () => ({component: 'Card'})});

    expect(() =>
      new MacroExpander([Text]).transformToInferenceCatalog(loadBasicCatalog('1.0')),
    ).toThrow(A2uiCatalogError);
    const catalog = new MacroExpander([Text], {
      passthroughComponents: [],
    }).transformToInferenceCatalog(loadBasicCatalog('1.0'));
    expect([...catalog.components.keys()]).toEqual(['Text']);
  });

  it('prunes the base catalogs and appends the macro catalog', () => {
    const expander = new MacroExpander([Badge], {passthroughComponents: ['Text']});

    const catalogs = expander.transformCatalogs([loadBasicCatalog('1.0')]);

    expect(catalogs.map(catalog => catalog.id)).toEqual([
      BASIC_CATALOG_IDS['1.0'],
      'https://a2ui.org/catalogs/macros',
    ]);
    expect([...catalogs[0].components.keys()]).toEqual(['Text']);
    expect([...catalogs[1].components.keys()]).toEqual(['Badge']);
  });

  it('adds the macros to the base catalog that has the expander catalog ID', () => {
    const expander = new MacroExpander([Badge], {catalogId: BASIC_CATALOG_IDS['1.0']});

    const catalogs = expander.transformCatalogs([loadBasicCatalog('1.0')]);

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0].components.has('Badge')).toBe(true);
    expect(catalogs[0].components.has('Text')).toBe(true);
  });

  it('returns the macro catalog alone, or nothing, without base catalogs', () => {
    expect(new MacroExpander([Badge]).transformCatalogs([]).map(c => c.id)).toEqual([
      'https://a2ui.org/catalogs/macros',
    ]);
    expect(new MacroExpander([]).transformCatalogs([])).toEqual([]);
  });

  it('rejects base catalogs of another protocol version', () => {
    expect(() => new MacroExpander([Badge], {baseCatalogs: [loadBasicCatalog('v0.9')]})).toThrow(
      A2uiValidationError,
    );
    expect(() => new MacroExpander([Badge]).transformCatalogs([loadBasicCatalog('v0.9')])).toThrow(
      A2uiValidationError,
    );
  });
});
