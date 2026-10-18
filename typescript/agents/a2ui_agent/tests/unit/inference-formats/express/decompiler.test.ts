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

import {A2uiCatalogError} from '../../../../src/errors.js';
import {ExpressDecompiler} from '../../../../src/inference-formats/express/decompiler.js';
import {
  ExpressInvalidIdentifierError,
  ExpressUnknownComponentError,
  ExpressUnknownFunctionError,
  ExpressValidationError,
} from '../../../../src/inference-formats/express/errors.js';
import {ExpressParser} from '../../../../src/inference-formats/express/parser.js';
import {AgentToRendererMessage, CatalogApi} from '../../../../src/internal/web-core.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {
  catalogFromTestDocument,
  loadConformanceCatalog,
} from '../../../helpers/conformance-catalogs.js';

const catalogInfo: Record<string, {catalog: CatalogApi; version: string}> = {
  basic_v0_9: {catalog: loadBasicCatalog('v0.9'), version: 'v0.9'},
  forms: {catalog: loadConformanceCatalog('forms_catalog_v1_0.json'), version: 'v1.0'},
  simplified: {catalog: loadConformanceCatalog('simplified_catalog_v1_0.json'), version: 'v1.0'},
};

describe('ExpressDecompiler', () => {
  function getCatalogInfo(catalogKey: string): {catalog: CatalogApi; version: string} {
    return catalogInfo[catalogKey];
  }

  describe('Writing components and data models', () => {
    it('writes data values that are not objects at their own paths', () => {
      const {catalog, version} = getCatalogInfo('basic_v0_9');
      const messages = [
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 'default', path: '/title', value: 'Found Restaurants'},
        },
        {
          version: 'v0.9',
          updateDataModel: {
            surfaceId: 'default',
            path: '/items',
            value: [{name: "Xi'an Famous Foods", rating: 4.5}],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("default")\n$/title = "Found Restaurants"\nsurface("default")\n$/items = [{name: "Xi\'an Famous Foods", rating: 4.5}]',
      );
    });

    it('writes empty strings, zero, false, empty lists, and empty objects at non-root paths', () => {
      const {catalog, version} = getCatalogInfo('basic_v0_9');
      const write = (path: string, value: unknown) => ({
        version: 'v0.9',
        updateDataModel: {surfaceId: 'default', path, value},
      });
      const messages = [
        write('/empty', ''),
        write('/zero', 0),
        write('/off', false),
        write('/none', []),
        write('/nothing', {}),
      ] as unknown as AgentToRendererMessage[];
      const decompiler = new ExpressDecompiler([catalog], version);
      const expected =
        'surface("default")\n$/empty = ""\nsurface("default")\n$/zero = 0\nsurface("default")\n$/off = false\nsurface("default")\n$/none = []\nsurface("default")\n$/nothing = {}';
      expect(decompiler.decompile(messages)).toBe(expected);
      expect(decompiler.decompile(messages[1])).toBe('surface("default")\n$/zero = 0');
      expect(decompiler.decompile(messages[4])).toBe('surface("default")\n$/nothing = {}');
      expect(new ExpressParser([catalog], 'default', version).compile(expected)).toEqual([
        write('/', {empty: ''}),
        write('/', {zero: 0}),
        write('/', {off: false}),
        write('/', {none: []}),
        write('/', {nothing: {}}),
      ]);
    });

    it('writes null when updateDataModel has a non-root path and no value, and omits empty root updateDataModel', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const parser = new ExpressParser([catalog], 's1', version);

      const valueless = {
        version: 'v1.0',
        updateDataModel: {surfaceId: 's1', path: '/x'},
      } as unknown as AgentToRendererMessage;
      const dsl = decompiler.decompile(valueless);
      expect(dsl).toBe('surface("s1")\n$/x = null');
      expect(parser.compile(dsl)).toEqual([
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 's1', path: '/', value: {x: null}},
        },
      ]);

      const emptyRoot = {
        version: 'v1.0',
        updateDataModel: {surfaceId: 's1', path: '/', value: {}},
      } as unknown as AgentToRendererMessage;
      expect(decompiler.decompile(emptyRoot)).toBe('');
    });
  });

  describe('Writing other messages', () => {
    it('writes a callFunction message as a standalone call', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          callFunction: {'@call': 'openUrl', args: {url: 'https://example.com/help'}},
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'openUrl("https://example.com/help")',
      );
    });

    it('accepts positional list-form args in function calls', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          callFunction: {'@call': 'openUrl', args: ['https://example.com']},
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'openUrl("https://example.com")',
      );
    });

    it('writes a standalone call with two arguments', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {
          version: 'v1.0',
          callFunction: {'@call': 'regex', args: {value: '123', pattern: '^[0-9]+$'}},
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'regex("123", "^[0-9]+$")',
      );
    });

    it('writes a deleteSurface message', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {version: 'v1.0', deleteSurface: {surfaceId: 'panel_surface_42'}},
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'deleteSurface("panel_surface_42")',
      );
    });
  });

  describe('Writing v0.9 messages', () => {
    it('writes a createSurface', () => {
      const {catalog, version} = getCatalogInfo('basic_v0_9');
      const messages = [
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'surf_09',
            components: [{id: 'root', component: 'Text', text: 'v0.9 message'}],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("surf_09")\nroot = Text("v0.9 message")',
      );
    });

    it('writes an updateComponents', () => {
      const {catalog, version} = getCatalogInfo('basic_v0_9');
      const messages = [
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'surf_09',
            components: [
              {id: 'card1', component: 'Card', child: 't1'},
              {id: 't1', component: 'Text', text: 'updated'},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("surf_09")\ncard1 = Card(t1)\nt1 = Text("updated")',
      );
    });

    it('writes an updateDataModel as one assignment per leaf', () => {
      const {catalog, version} = getCatalogInfo('basic_v0_9');
      const messages = [
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 'surf_09', value: {profile: {name: 'Bob', active: true}}},
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("surf_09")\n$/profile/active = true\n$/profile/name = "Bob"',
      );
    });
  });
  describe('2. wrapDecompiledBlocks', () => {
    it('wraps blocks in sentinel tags', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const blocks = ['surface("s1")', 'root = Text("Hello")'];
      const wrapped = decompiler.wrapDecompiledBlocks(blocks);
      expect(wrapped).toBe('<a2ui>\nsurface("s1")\nroot = Text("Hello")\n</a2ui>');
    });

    it('joins multiple blocks with newlines inside sentinel tags', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const blocks = ['surface("s1")', 'root = Text("Hello")', '$/key = 42'];
      const wrapped = decompiler.wrapDecompiledBlocks(blocks);
      expect(wrapped).toBe('<a2ui>\nsurface("s1")\nroot = Text("Hello")\n$/key = 42\n</a2ui>');
    });
  });

  describe('3. Single message input and edge cases', () => {
    it('accepts a single message object instead of array', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        deleteSurface: {
          surfaceId: 's1',
        },
      } as AgentToRendererMessage;
      const actual = decompiler.decompile(msg);
      expect(actual).toBe('deleteSurface("s1")');
    });

    it('returns empty string for empty message list', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      expect(decompiler.decompile([])).toBe('');
    });

    it('supports useKeywordArgs = true', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'conformance/simplified',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Hello',
            },
          ],
        },
      } as AgentToRendererMessage;
      const actual = decompiler.decompile(msg, true);
      expect(actual).toBe('surface("s1")\nroot = Text(text="Hello")');
    });
  });

  describe('Follow-up 3: Map keys that are grammar keywords are quoted on decompile', () => {
    it('quotes true, false, null as dictionary keys', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        createSurface: {
          surfaceId: 'default_surface',
          components: [
            {
              id: 'c1',
              component: 'Card',
              child: {
                event: {
                  name: 'e1',
                  context: {
                    true: 1,
                    false: 2,
                    null: 3,
                    valid_key: 4,
                  },
                },
              },
            },
          ],
        },
      } as unknown as AgentToRendererMessage;
      const dsl = decompiler.decompile(msg);
      expect(dsl).toContain(
        'c1 = Card(Event("e1", {"true": 1, "false": 2, "null": 3, valid_key: 4}))',
      );
    });
  });

  describe('B6: decompiling a component id that is not an Express identifier throws', () => {
    it('throws ExpressInvalidIdentifierError when component id contains hyphen', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        createSurface: {
          surfaceId: 'default_surface',
          components: [
            {
              id: 'title-heading',
              component: 'Text',
              text: 'Hello',
            },
          ],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(msg)).toThrow(ExpressInvalidIdentifierError);
    });

    it('throws ExpressInvalidIdentifierError when component id is a reserved keyword', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        createSurface: {
          surfaceId: 'default_surface',
          components: [
            {
              id: 'true',
              component: 'Text',
              text: 'Hello',
            },
          ],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(msg)).toThrow(ExpressInvalidIdentifierError);
    });
  });

  describe('decompiling an object-valued field that is not an object throws', () => {
    function decompileButton(action: unknown): string {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        createSurface: {
          surfaceId: 'default_surface',
          components: [{id: 'c1', component: 'Card', child: action}],
        },
      } as unknown as AgentToRendererMessage;
      return decompiler.decompile(msg);
    }

    it('throws when an event context is a string', () => {
      expect(() => decompileButton({event: {name: 'go', context: 'oops'}})).toThrow(
        ExpressValidationError,
      );
      expect(() => decompileButton({event: {name: 'go', context: 'oops'}})).toThrow(
        /Event 'go' has a non-object 'context'/,
      );
    });

    it('throws when an event context is an array', () => {
      expect(() => decompileButton({event: {name: 'go', context: [1, 2]}})).toThrow(
        ExpressValidationError,
      );
    });

    it('throws when function call args are a string', () => {
      expect(() =>
        decompileButton({functionCall: {'@call': 'openUrl', args: 'https://example.com'}}),
      ).toThrow(/Function call 'openUrl' has a non-object 'args'/);
    });

    it('still treats absent or null fields as empty', () => {
      expect(decompileButton({event: {name: 'go'}})).toContain('Event("go")');
      expect(decompileButton({event: {name: 'go', context: null}})).toContain('Event("go")');
    });

    it('escapes event names so they compile back unchanged', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const action = {event: {name: 'say "hi" \\ bye', context: {k: 1}}};
      const msg = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          components: [
            {id: 'root', component: 'Button', child: 'label', action},
            {id: 'label', component: 'Text', text: 'Go'},
          ],
        },
      } as unknown as AgentToRendererMessage;
      const notation = new ExpressDecompiler([catalog], version).decompile(msg);
      const recompiled = new ExpressParser([catalog], 's1', version).compile(notation);
      const components = (
        recompiled[0] as unknown as {createSurface: {components: Array<Record<string, unknown>>}}
      ).createSurface.components;
      expect(components.find(c => c.id === 'root')?.action).toEqual(action);
    });
  });

  describe('Surface message coalescing', () => {
    it('coalesces createSurface + updateComponents + root updateDataModel into one block', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: catalog.id,
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Text', text: 'Hello'}],
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 's1',
            path: '/',
            value: {greeting: 'World'},
          },
        },
      ] as unknown as AgentToRendererMessage[];

      expect(decompiler.decompile(messages)).toBe(
        'surface("s1")\n$/greeting = "World"\nroot = Text("Hello")',
      );
    });

    it('replaces rather than merges successive root updateDataModel messages and createSurface.dataModel', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const parser = new ExpressParser([catalog], 's1', version);

      const twoRootUpdates = [
        {
          version: 'v1.0',
          createSurface: {surfaceId: 's1', catalogId: catalog.id},
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Text', text: 'hi'}],
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 's1', path: '/', value: {a: 1, b: 2}},
        },
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 's1', path: '/', value: {a: 3}},
        },
      ] as unknown as AgentToRendererMessage[];
      const dsl1 = decompiler.decompile(twoRootUpdates);
      expect(dsl1).toBe('surface("s1")\n$/a = 3\nroot = Text("hi")');
      expect(
        (parser.compile(dsl1)[0] as unknown as {createSurface: {dataModel: unknown}}).createSurface
          .dataModel,
      ).toEqual({a: 3});

      const createWithDataThenRootUpdate = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: catalog.id,
            components: [{id: 'root', component: 'Text', text: 'hi'}],
            dataModel: {a: 1, b: 2},
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 's1', value: {a: 3}},
        },
      ] as unknown as AgentToRendererMessage[];
      const dsl2 = decompiler.decompile(createWithDataThenRootUpdate);
      expect(dsl2).toBe('surface("s1")\n$/a = 3\nroot = Text("hi")');
      expect(
        (parser.compile(dsl2)[0] as unknown as {createSurface: {dataModel: unknown}}).createSurface
          .dataModel,
      ).toEqual({a: 3});
    });

    it('does not coalesce non-root updateDataModel (e.g. path: "/count")', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: catalog.id,
            components: [{id: 'root', component: 'Text', text: 'Count'}],
          },
        },
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 's1',
            path: '/count',
            value: 1,
          },
        },
      ] as unknown as AgentToRendererMessage[];

      expect(decompiler.decompile(messages)).toBe(
        'surface("s1")\nroot = Text("Count")\nsurface("s1")\n$/count = 1',
      );
    });

    it('emits surface("default_surface") when default_surface follows another surface', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const parser = new ExpressParser([catalog], 'default_surface', version);

      const csADoc = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 'a',
          catalogId: catalog.id,
          components: [{id: 'root', component: 'Text', text: 'A'}],
        },
      };

      const withDataUpdate = [
        csADoc,
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 'default_surface', path: '/x', value: 1},
        },
      ] as unknown as AgentToRendererMessage[];
      const dslData = decompiler.decompile(withDataUpdate);
      expect(dslData).toBe('surface("a")\nroot = Text("A")\nsurface("default_surface")\n$/x = 1');
      expect(parser.compile(dslData)).toEqual([
        csADoc,
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 'default_surface', path: '/', value: {x: 1}},
        },
      ]);

      const withCreateDefault = [
        csADoc,
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: catalog.id,
            components: [{id: 'root', component: 'Text', text: 'D'}],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      const dslCreate = decompiler.decompile(withCreateDefault);
      expect(dslCreate).toBe(
        'surface("a")\nroot = Text("A")\nsurface("default_surface")\nroot = Text("D")',
      );
      expect(parser.compile(dslCreate)).toEqual(withCreateDefault);

      const withUpdateComponents = [
        csADoc,
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'default_surface',
            components: [{id: 't2', component: 'Text', text: 'D'}],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      const dslUpdate = decompiler.decompile(withUpdateComponents);
      expect(dslUpdate).toBe(
        'surface("a")\nroot = Text("A")\nsurface("default_surface")\nt2 = Text("D")',
      );
      expect(parser.compile(dslUpdate)).toEqual(withUpdateComponents);
    });
  });

  describe('Multi-catalog resolution', () => {
    const primaryCatalog = catalogFromTestDocument({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      catalogId: 'test/primary',
      protocolVersion: 'v1.0',
      components: {
        Column: {
          properties: {
            children: {$ref: 'common_types.json#/$defs/ChildList'},
          },
        },
        Text: {
          properties: {
            text: {$ref: 'common_types.json#/$defs/DynamicString'},
          },
        },
        SharedWidget: {
          allOf: [
            {$ref: 'common_types.json#/$defs/Checkable'},
            {
              properties: {
                primaryArg: {type: 'string'},
                action: {$ref: 'common_types.json#/$defs/Action'},
              },
            },
          ],
        },
      },
      functions: {
        primaryCheck: {
          returnType: 'boolean',
          properties: {
            args: {
              type: 'object',
              properties: {target: {type: 'string'}},
              required: ['target'],
            },
          },
        },
        sharedFn: {
          returnType: 'boolean',
          properties: {
            args: {
              type: 'object',
              properties: {
                firstPrimary: {type: 'string'},
                secondPrimary: {type: 'string'},
              },
              required: ['firstPrimary'],
            },
          },
        },
      },
    });

    const secondaryCatalog = catalogFromTestDocument({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      catalogId: 'test/secondary',
      protocolVersion: 'v1.0',
      components: {
        SecondaryCard: {
          properties: {
            headline: {type: 'string'},
            subtitle: {type: 'string'},
          },
        },
        SharedWidget: {
          allOf: [
            {$ref: 'common_types.json#/$defs/Checkable'},
            {
              properties: {
                secondaryArg: {type: 'string'},
                action: {$ref: 'common_types.json#/$defs/Action'},
              },
            },
          ],
        },
      },
      functions: {
        secondaryCheck: {
          returnType: 'boolean',
          properties: {
            args: {
              type: 'object',
              properties: {threshold: {type: 'number'}},
              required: ['threshold'],
            },
          },
        },
        sharedFn: {
          returnType: 'boolean',
          properties: {
            args: {
              type: 'object',
              properties: {
                firstSecondary: {type: 'string'},
                secondSecondary: {type: 'string'},
              },
              required: ['firstSecondary'],
            },
          },
        },
      },
    });

    it('rejects duplicate catalog IDs and multiple v0.9 catalogs in the constructor', () => {
      expect(() => new ExpressDecompiler([primaryCatalog, primaryCatalog], 'v1.0')).toThrow(
        A2uiCatalogError,
      );

      const v09a = catalogFromTestDocument({
        catalogId: 'test/v09_a',
        protocolVersion: 'v0.9',
        components: {
          Text: {properties: {text: {type: 'string'}}},
        },
      });
      const v09b = catalogFromTestDocument({
        catalogId: 'test/v09_b',
        protocolVersion: 'v0.9',
        components: {
          Text: {properties: {text: {type: 'string'}}},
        },
      });
      expect(() => new ExpressDecompiler([v09a, v09b], 'v0.9')).toThrow(A2uiCatalogError);
    });

    it('omits catalogId for unique names, emits catalogId for shared names, and never emits catalogId on surface(...)', () => {
      const decompiler = new ExpressDecompiler([primaryCatalog, secondaryCatalog], 'v1.0');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'test/primary',
            components: [
              {
                id: 'w1',
                component: 'SharedWidget',
                catalogId: 'test/primary',
                primaryArg: 'from-primary',
                checks: [
                  {
                    condition: {
                      '@call': 'primaryCheck',
                      catalogId: 'test/primary',
                      args: {target: 'ok'},
                    },
                    message: 'Bad primary',
                  },
                  {
                    condition: {
                      '@call': 'secondaryCheck',
                      catalogId: 'test/secondary',
                      args: {threshold: 42},
                    },
                    message: 'Bad secondary',
                  },
                ],
              },
              {
                id: 'w2',
                component: 'SharedWidget',
                catalogId: 'test/secondary',
                secondaryArg: 'from-secondary',
                checks: [
                  {
                    condition: {
                      '@call': 'sharedFn',
                      catalogId: 'test/secondary',
                      args: {firstSecondary: 'sec-1', secondSecondary: 'sec-2'},
                    },
                    message: 'Check sec',
                  },
                ],
                action: {
                  functionCall: {
                    '@call': 'sharedFn',
                    catalogId: 'test/primary',
                    args: {firstPrimary: 'act-1', secondPrimary: 'act-2'},
                  },
                },
              },
              {
                id: 'c1',
                component: 'SecondaryCard',
                catalogId: 'test/secondary',
                headline: 'Title',
                subtitle: 'Sub',
              },
              {
                id: 'root',
                component: 'Column',
                catalogId: 'test/primary',
                children: ['w1', 'w2', 'c1'],
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];

      const dsl = decompiler.decompile(messages);
      expect(dsl.split('\n')[0]).toBe('surface("main")');
      expect(dsl).not.toContain('surface("main", catalogId=');
      expect(dsl).toContain('c1 = SecondaryCard("Title", "Sub")');
      expect(dsl).toContain('root = Column([w1, w2, c1])');
      expect(dsl).toContain('?primaryCheck("ok", "Bad primary")');
      expect(dsl).toContain('?secondaryCheck(42, "Bad secondary")');
      expect(dsl).toContain('catalogId="test/primary"');
      expect(dsl).toContain('catalogId="test/secondary"');
      expect(dsl).toContain('{catalogId: "test/secondary"}');
      expect(dsl).toContain('sharedFn("act-1", "act-2", catalogId="test/primary")');
    });

    it('throws ExpressValidationError when createSurface or a component targets an inactive catalog or wrong catalog', () => {
      const decompiler = new ExpressDecompiler([primaryCatalog, secondaryCatalog], 'v1.0');

      const unknownSurfaceCat = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: 'test/unknown',
          components: [{id: 'root', component: 'Text', text: 'Hi'}],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(unknownSurfaceCat)).toThrow(ExpressValidationError);
      expect(() => decompiler.decompile(unknownSurfaceCat)).toThrow(
        "Surface 's1' targets unknown catalog 'test/unknown'. Active catalogs: 'test/primary', 'test/secondary'.",
      );

      const unknownCompCat = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          components: [{id: 'root', component: 'Text', catalogId: 'test/unknown', text: 'Hi'}],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(unknownCompCat)).toThrow(
        "Component 'Text' targets unknown catalog 'test/unknown'. Active catalogs: 'test/primary', 'test/secondary'.",
      );

      const wrongCompCat = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          components: [
            {
              id: 'root',
              component: 'SecondaryCard',
              catalogId: 'test/primary',
              headline: 'H',
            },
          ],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(wrongCompCat)).toThrow(
        "Component 'SecondaryCard' is not in catalog 'test/primary'. It is defined in: 'test/secondary'.",
      );
    });

    it('forgets a surface catalog after deleteSurface when multiple catalogs are active', () => {
      const decompiler = new ExpressDecompiler([primaryCatalog, secondaryCatalog], 'v1.0');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'test/primary',
            components: [{id: 'root', component: 'Text', text: 'Hi'}],
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {surfaceId: 's1'},
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 't1', component: 'Text', text: 'After delete'}],
          },
        },
      ] as unknown as AgentToRendererMessage[];

      expect(() => decompiler.decompile(messages)).toThrow(ExpressValidationError);
      expect(() => decompiler.decompile(messages)).toThrow(
        "Component 'Text' has no catalogId and its surface has no catalogId.",
      );
    });
  });

  describe('Surface options, functionCallId, and bare check rules', () => {
    it('emits sendDataModel=true on createSurface', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          sendDataModel: true,
          components: [{id: 'root', component: 'Text', text: 'Hello'}],
        },
      } as unknown as AgentToRendererMessage;

      expect(decompiler.decompile(msg)).toBe(
        'surface("s1", sendDataModel=true)\nroot = Text("Hello")',
      );
    });

    it('emits update=true on updateComponents when components contain root', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg = {
        version: 'v1.0',
        updateComponents: {
          surfaceId: 's1',
          components: [{id: 'root', component: 'Text', text: 'Updated'}],
        },
      } as unknown as AgentToRendererMessage;

      expect(decompiler.decompile(msg)).toBe('surface("s1", update=true)\nroot = Text("Updated")');
    });

    it('emits functionCallId on callRendererFunction when it is not the default call_<index>', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const messages = [
        {
          version: 'v1.0',
          callRendererFunction: {
            functionCallId: 'call_1',
            callFunction: {
              catalogId: catalog.id,
              '@call': 'openUrl',
              args: {url: 'https://example.com/1'},
            },
          },
        },
        {
          version: 'v1.0',
          callRendererFunction: {
            functionCallId: 'custom_id_99',
            callFunction: {
              catalogId: catalog.id,
              '@call': 'openUrl',
              args: {url: 'https://example.com/2'},
            },
          },
        },
      ] as unknown as AgentToRendererMessage[];

      expect(decompiler.decompile(messages)).toBe(
        'openUrl("https://example.com/1")\nopenUrl("https://example.com/2", functionCallId="custom_id_99")',
      );
    });

    it('decompiles a bare check rule without a condition wrapper and supports checks= in keyword mode', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const decompiler = new ExpressDecompiler([catalog], version);
      const parser = new ExpressParser([catalog], 's1', version);
      const msg = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          components: [
            {
              id: 'root',
              component: 'TextField',
              label: 'Name',
              value: {'@path': '/name'},
              checks: [{'@call': 'required'}],
            },
          ],
        },
      } as unknown as AgentToRendererMessage;

      expect(decompiler.decompile(msg)).toBe(
        'surface("s1")\nroot = TextField("Name", $/name, ?required)',
      );

      const kwDsl = decompiler.decompile(msg, true);
      expect(kwDsl).toBe(
        'surface("s1")\nroot = TextField(label="Name", value=$/name, checks=?required)',
      );
      expect(parser.compile(kwDsl)).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: catalog.id,
            components: [
              {
                id: 'root',
                component: 'TextField',
                label: 'Name',
                value: {'@path': '/name'},
                checks: [
                  {
                    condition: {'@call': 'required', args: {value: {'@path': '/name'}}},
                    message: 'Required check failed',
                  },
                ],
              },
            ],
          },
        },
      ]);
    });

    it('throws ExpressUnknownComponentError and ExpressUnknownFunctionError for unknown symbols', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);

      const unknownComp = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          components: [{id: 'root', component: 'NonExistentWidget', text: 'Hi'}],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(unknownComp)).toThrow(ExpressUnknownComponentError);

      const unknownStandaloneFn = {
        version: 'v1.0',
        callFunction: {'@call': 'nonExistentFn', args: {}},
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(unknownStandaloneFn)).toThrow(ExpressUnknownFunctionError);

      const unknownExprFn = {
        version: 'v1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          components: [
            {
              id: 'root',
              component: 'Text',
              text: {'@call': 'nonExistentFn', args: {}},
            },
          ],
        },
      } as unknown as AgentToRendererMessage;
      expect(() => decompiler.decompile(unknownExprFn)).toThrow(ExpressUnknownFunctionError);
    });
  });
});
