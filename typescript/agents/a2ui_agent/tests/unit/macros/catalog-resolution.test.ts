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

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  A2uiCatalogError,
  type AgentToRendererMessage,
  Catalog,
  type CatalogApi,
  type ComponentNode,
  defineMacro,
  MacroExpander,
} from '../../../src/index.js';
import {BASIC_CATALOG_IDS, loadBasicCatalog} from '../../helpers/basic-catalogs.js';

const MACROS_ID = 'https://a2ui.org/catalogs/macros';
const WIDGETS_ID = 'https://example.com/widgets.json';

/** A v1.0 catalog with one `Widget` component, which may declare its own `catalogId`. */
function widgetsCatalog(widgetProperties: Record<string, unknown> = {}): CatalogApi {
  return Catalog.fromJson({
    protocolVersion: '1.0',
    catalogId: WIDGETS_ID,
    components: {
      Widget: {
        type: 'object',
        properties: {component: {const: 'Widget'}, ...widgetProperties},
        required: ['component'],
      },
    },
    $defs: {
      anyComponent: {
        oneOf: [{$ref: '#/components/Widget'}],
        discriminator: {propertyName: 'component'},
      },
      anyFunction: {not: {}},
    },
  });
}

const Hello = defineMacro({
  name: 'Hello',
  render: (): ComponentNode => ({component: 'Text', text: 'Hello'}),
});

function lower(
  expander: MacroExpander,
  messages: unknown[],
): Array<Record<string, Record<string, unknown>>> {
  return expander.transformToTransport(messages as AgentToRendererMessage[]) as unknown as Array<
    Record<string, Record<string, unknown>>
  >;
}

describe('MacroExpander catalog resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a macro-catalog surface default when several base catalogs are registered', () => {
    const expander = new MacroExpander([Hello], {
      baseCatalogs: [loadBasicCatalog('1.0'), widgetsCatalog()],
    });

    const [created, updated] = lower(expander, [
      {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: MACROS_ID}},
      {
        version: 'v1.0',
        updateComponents: {surfaceId: 's', components: [{component: 'Hello', id: 'h'}]},
      },
    ]);

    expect(created['createSurface']).toEqual({surfaceId: 's'});
    expect(updated['updateComponents']['components']).toEqual([
      {component: 'Text', id: 'h', text: 'Hello', '@catalogId': BASIC_CATALOG_IDS['1.0']},
    ]);
  });

  it('rejects a macro-catalog surface default without a base catalog to replace it', () => {
    expect(() =>
      lower(new MacroExpander([Hello]), [
        {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: MACROS_ID}},
      ]),
    ).toThrow(A2uiCatalogError);
  });

  it('expands a macro named like a base component that passthroughComponents prunes', () => {
    const Text = defineMacro({
      name: 'Text',
      render: (): ComponentNode => ({component: 'Card', child: 'other'}),
    });
    const update = {
      version: 'v1.0',
      updateComponents: {surfaceId: 's', components: [{component: 'Text', id: 't'}]},
    };
    const created = {
      version: 'v1.0',
      createSurface: {surfaceId: 's', catalogId: BASIC_CATALOG_IDS['1.0']},
    };

    const kept = lower(new MacroExpander([Text], {baseCatalogs: [loadBasicCatalog('1.0')]}), [
      created,
      update,
    ]);
    const pruned = lower(
      new MacroExpander([Text], {
        baseCatalogs: [loadBasicCatalog('1.0')],
        passthroughComponents: ['Card'],
      }),
      [created, update],
    );

    expect(kept[1]['updateComponents']['components']).toEqual([{component: 'Text', id: 't'}]);
    expect(pruned[1]['updateComponents']['components']).toEqual([
      {component: 'Card', id: 't', child: 'other'},
    ]);
  });

  it('stamps a component whose bare catalogId is a property its catalog declares', () => {
    const Wrapped = defineMacro({
      name: 'Wrapped',
      render: (): ComponentNode => ({component: 'Widget', catalogId: 'sku-1'}),
    });
    const messages = [
      {version: 'v1.0', createSurface: {surfaceId: 's'}},
      {
        version: 'v1.0',
        updateComponents: {surfaceId: 's', components: [{component: 'Wrapped', id: 'w'}]},
      },
    ];

    const custom = lower(
      new MacroExpander([Wrapped], {baseCatalogs: [widgetsCatalog({catalogId: {type: 'string'}})]}),
      messages,
    );
    const legacy = lower(
      new MacroExpander([Wrapped], {baseCatalogs: [widgetsCatalog()]}),
      messages,
    );

    expect(custom[1]['updateComponents']['components']).toEqual([
      {component: 'Widget', id: 'w', catalogId: 'sku-1', '@catalogId': WIDGETS_ID},
    ]);
    expect(legacy[1]['updateComponents']['components']).toEqual([
      {component: 'Widget', id: 'w', catalogId: 'sku-1'},
    ]);
  });

  it('skips an invocation with an empty catalogId and warns', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const [message] = lower(new MacroExpander([Hello]), [
      {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's',
          components: [{component: 'Hello', id: 'h', '@catalogId': ''}],
        },
      },
    ]);

    expect(message['updateComponents']['components']).toEqual([
      {component: 'Hello', id: 'h', '@catalogId': ''},
    ]);
    expect(warned).toHaveBeenCalledTimes(1);
  });
});
