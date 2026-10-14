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

import {ExpressDecompiler} from '../../../../src/inference-formats/express/decompiler.js';
import {
  ExpressInvalidIdentifierError,
  ExpressValidationError,
} from '../../../../src/inference-formats/express/errors.js';
import {ExpressParser} from '../../../../src/inference-formats/express/parser.js';
import {AgentToRendererMessage, CatalogApi} from '../../../../src/internal/web-core.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

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
        'surface("default")\n$/title = "Found Restaurants"\n$/items = [{name: "Xi\'an Famous Foods", rating: 4.5}]',
      );
    });

    it('writes empty strings, zero, false and empty lists', () => {
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
      expect(decompiler.decompile(messages)).toBe(
        'surface("default")\n$/empty = ""\n$/zero = 0\n$/off = false\n$/none = []',
      );
      expect(decompiler.decompile(messages[1])).toBe('surface("default")\n$/zero = 0');
      expect(decompiler.decompile(messages[4])).toBe('surface("default")');
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
});
