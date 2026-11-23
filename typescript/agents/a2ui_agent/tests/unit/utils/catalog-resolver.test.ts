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

import {MessageProcessor} from '@a2ui/web_core';
import {describe, expect, it, vi} from 'vitest';

import {
  A2UI_CLIENT_CAPABILITIES_KEY,
  A2UI_RENDERER_CAPABILITIES_KEY,
  A2uiCatalogError,
  A2uiValidationError,
  Catalog,
  CatalogConfig,
  readRendererCapabilities,
  RendererCapabilities,
  resolveCatalogs,
} from '../../../src/index.js';

describe('resolveCatalogs', () => {
  const catBasic = new Catalog('id_basic', '1.0', [], []);
  const catCustom1 = new Catalog('id_custom1', '1.0', [], []);
  const catCustom2 = new Catalog('id_custom2', '1.0', [], []);

  const configBasic = new CatalogConfig(catBasic);
  const configCustom1 = new CatalogConfig(catCustom1);
  const configCustom2 = new CatalogConfig(catCustom2);

  const supportedConfigs = [configBasic, configCustom1, configCustom2];

  const inline = (catalogId: string) => ({catalogId, protocolVersion: '1.0', components: {}});

  it('activates every catalog the renderer names, in its preference order', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: ['id_custom2', 'id_basic'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.map(c => c.id)).toEqual(['id_custom2', 'id_basic']);
  });

  it('ignores ids the agent does not hold', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: ['id_not_exists', 'id_custom1'],
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.map(c => c.id)).toEqual(['id_custom1']);
  });

  it('throws when the renderer names nothing the agent holds', () => {
    const caps: RendererCapabilities = {supportedCatalogIds: ['id_not_exists']};
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiCatalogError);
  });

  it('throws when supportedCatalogIds is empty and nothing is declared inline', () => {
    const caps: RendererCapabilities = {supportedCatalogIds: []};
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiCatalogError);
  });

  it('adds each accepted inline catalog as an active catalog of its own', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: ['id_basic'],
      inlineCatalogs: [inline('id_inline1'), inline('id_inline2')],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.map(c => c.id)).toEqual(['id_basic', 'id_inline1', 'id_inline2']);
  });

  it('accepts an inline catalog alone when no registered id matches', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [inline('id_inline')],
    };
    const resolved = resolveCatalogs([configBasic], caps, true);
    expect(resolved.map(c => c.id)).toEqual(['id_inline']);
  });

  it('drops inline catalogs the agent does not accept', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: ['id_basic'],
      inlineCatalogs: [inline('id_inline')],
    };
    const resolved = resolveCatalogs([configBasic], caps, false);
    expect(resolved.map(c => c.id)).toEqual(['id_basic']);
  });

  it('throws when an accepted inline catalog states no protocol version', () => {
    const caps: RendererCapabilities = {
      supportedCatalogIds: [],
      inlineCatalogs: [{catalogId: 'id_inline', components: {}}],
    };
    expect(() => resolveCatalogs([configBasic], caps, true)).toThrowError(A2uiCatalogError);
  });

  it('activates every registered catalog when capabilities are absent', () => {
    const resolved = resolveCatalogs(supportedConfigs, undefined);
    expect(resolved.map(c => c.id)).toEqual(['id_basic', 'id_custom1', 'id_custom2']);
  });

  it('resolves version-keyed capabilities for the registered catalogs protocol version', () => {
    const caps = {
      '1.0': {
        supportedCatalogIds: ['id_custom1', 'id_basic'],
      },
    };
    const resolved = resolveCatalogs(supportedConfigs, caps);
    expect(resolved.map(c => c.id)).toEqual(['id_custom1', 'id_basic']);
  });

  it('throws A2uiValidationError when version-keyed capabilities omit the catalogs version', () => {
    const caps = {
      'v0.8': {
        supportedCatalogIds: ['id_basic'],
      },
    };
    expect(() => resolveCatalogs(supportedConfigs, caps)).toThrowError(A2uiValidationError);
  });

  it('throws A2uiCatalogError when registered catalogs read different capabilities keys', () => {
    const catV09 = new Catalog('id_v09', 'v0.9', [], []);
    const mixedConfigs = [configBasic, new CatalogConfig(catV09)];
    expect(() =>
      resolveCatalogs(mixedConfigs, {'1.0': {supportedCatalogIds: ['id_basic']}}),
    ).toThrowError(A2uiCatalogError);
  });

  it('keeps the active registered catalog and warns when an inline catalog reuses its id', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const caps: RendererCapabilities = {
        supportedCatalogIds: ['id_basic'],
        inlineCatalogs: [
          {
            catalogId: 'id_basic',
            protocolVersion: '1.0',
            components: {
              Marquee: {
                type: 'object',
                properties: {component: {const: 'Marquee'}},
                required: ['component'],
              },
            },
          },
        ],
      };
      const resolved = resolveCatalogs([configBasic], caps, true);
      expect(resolved).toEqual([catBasic]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dropping inline catalog 'id_basic'"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps the first inline catalog and warns when duplicate inline catalog ids appear', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const caps: RendererCapabilities = {
        supportedCatalogIds: [],
        inlineCatalogs: [
          {
            catalogId: 'id_dup',
            protocolVersion: '1.0',
            components: {
              First: {
                type: 'object',
                properties: {component: {const: 'First'}},
                required: ['component'],
              },
            },
          },
          {
            catalogId: 'id_dup',
            protocolVersion: '1.0',
            components: {
              Second: {
                type: 'object',
                properties: {component: {const: 'Second'}},
                required: ['component'],
              },
            },
          },
        ],
      };
      const resolved = resolveCatalogs([configBasic], caps, true);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('id_dup');
      expect([...resolved[0].components.keys()]).toEqual(['First']);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Dropping inline catalog 'id_dup'"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each([
    '#/$defs/CatalogComponentCommon',
    '#/components/Missing',
    '#/catalogId',
    '#/__proto__',
    '#CatalogComponentCommon',
    '#/$defs/Bad~2Escape',
  ])('rejects inline catalog with unresolvable local $ref %s', badRef => {
    const inlineDoc = {
      catalogId: 'renderer/bad-ref',
      protocolVersion: '1.0',
      components: {
        Marquee: {
          type: 'object',
          properties: {
            component: {const: 'Marquee'},
            tone: {$ref: badRef},
          },
          required: ['component', 'tone'],
        },
      },
    };
    const caps = {'1.0': {supportedCatalogIds: ['id_basic'], inlineCatalogs: [inlineDoc]}};
    for (const acceptsInline of [true, false]) {
      expect(() => resolveCatalogs([configBasic], caps, acceptsInline)).toThrowError(
        A2uiCatalogError,
      );
      expect(() => resolveCatalogs([configBasic], caps, acceptsInline)).toThrowError(badRef);
    }
    expect(() =>
      readRendererCapabilities({[A2UI_RENDERER_CAPABILITIES_KEY]: caps}, '1.0'),
    ).toThrowError(A2uiCatalogError);
  });

  it('accepts v0.9 MessageProcessor inline catalogs with bare common_types $defs refs', () => {
    const v09Catalog = Catalog.fromJson(
      {
        catalogId: 'renderer/v09',
        components: {
          Label: {
            type: 'object',
            properties: {
              component: {const: 'Label'},
              text: {$ref: 'common_types.json#/$defs/DynamicString'},
            },
            required: ['component', 'text'],
          },
        },
      },
      'v0.9',
    );
    const processor = new MessageProcessor([v09Catalog]);
    const generated = processor.getRendererCapabilities({
      versions: ['v0.9'],
      includeInlineCatalogs: true,
    });
    const extracted = readRendererCapabilities({[A2UI_CLIENT_CAPABILITIES_KEY]: generated}, 'v0.9');
    expect(extracted).toBeDefined();
    const agentV09 = new CatalogConfig(new Catalog('agent/v09', 'v0.9', [], []));
    const resolved = resolveCatalogs([agentV09], extracted, true);
    expect(resolved.map(c => c.id)).toEqual(['renderer/v09']);

    // v1.0-only common types (such as Child) must be rejected on v0.9 inline catalogs.
    expect(() =>
      resolveCatalogs(
        [agentV09],
        {
          'v0.9': {
            supportedCatalogIds: [],
            inlineCatalogs: [
              {
                catalogId: 'renderer/v09-bad-common',
                components: {
                  Card: {
                    type: 'object',
                    properties: {
                      component: {const: 'Card'},
                      child: {$ref: '#/$defs/Child'},
                    },
                  },
                },
              },
            ],
          },
        },
        true,
      ),
    ).toThrowError(/#\/\$defs\/Child/);

    // Flat v0.9 theme with sibling 'type' and 'default' tokens validates 'default'.
    expect(() =>
      resolveCatalogs(
        [agentV09],
        {
          'v0.9': {
            supportedCatalogIds: [],
            inlineCatalogs: [
              {
                catalogId: 'renderer/theme-tokens',
                components: {},
                theme: {
                  type: {type: 'string'},
                  default: {$ref: '#/$defs/MissingThemeToken'},
                },
              },
            ],
          },
        },
        true,
      ),
    ).toThrowError(/MissingThemeToken/);

    expect(() =>
      resolveCatalogs(
        [agentV09],
        {
          'v0.9': {
            supportedCatalogIds: [],
            inlineCatalogs: [
              {
                catalogId: 'renderer/theme-ref',
                components: {},
                theme: {$ref: '#/$defs/MissingThemeSchema'},
              },
            ],
          },
        },
        true,
      ),
    ).toThrowError(/MissingThemeSchema/);
  });

  it('resolves escaped and indexed local pointers and ignores literal const $ref values', () => {
    const inlineDoc = {
      catalogId: 'renderer/escaped',
      protocolVersion: '1.0',
      components: {
        Marquee: {
          type: 'object',
          allOf: [{$ref: '#/$defs/a~1b~0c/allOf/0'}],
          properties: {
            component: {const: 'Marquee'},
            literalRef: {
              type: 'object',
              const: {$ref: '#/$defs/not_a_schema_ref'},
            },
            default: {type: 'string'},
          },
          required: ['component'],
        },
      },
      $defs: {
        'a/b~c': {
          allOf: [{type: 'object', properties: {label: {type: 'string'}}}],
        },
        anyComponent: {
          oneOf: [{$ref: '#/components/Marquee'}],
          discriminator: {propertyName: 'component'},
        },
        anyFunction: {not: {}},
      },
    };
    const resolved = resolveCatalogs(
      [configBasic],
      {'1.0': {supportedCatalogIds: [], inlineCatalogs: [inlineDoc]}},
      true,
    );
    expect(resolved.map(c => c.id)).toEqual(['renderer/escaped']);

    const badDefaultProp = {
      ...inlineDoc,
      components: {
        Marquee: {
          type: 'object',
          properties: {
            component: {const: 'Marquee'},
            default: {$ref: '#/$defs/MissingDefaultSchema'},
          },
          required: ['component'],
        },
      },
    };
    expect(() =>
      resolveCatalogs(
        [configBasic],
        {'1.0': {supportedCatalogIds: [], inlineCatalogs: [badDefaultProp]}},
        true,
      ),
    ).toThrowError(/MissingDefaultSchema/);
  });
});
