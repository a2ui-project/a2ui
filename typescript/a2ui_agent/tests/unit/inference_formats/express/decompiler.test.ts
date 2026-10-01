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

import {ExpressDecompiler} from '../../../../src/inference_formats/express/decompiler.js';
import {
  ExpressInvalidIdentifierError,
  ExpressValidationError,
} from '../../../../src/inference_formats/express/errors.js';
import {ExpressParser} from '../../../../src/inference_formats/express/parser.js';
import {AgentToRendererMessage} from '../../../../src/internal/web_core.js';
import {SchemaCatalog} from '../../../../src/types.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const catalogInfo: Record<string, {catalog: SchemaCatalog; version: string}> = {
  basic_v0_9: {catalog: await loadBasicCatalog('v0.9'), version: 'v0.9'},
  forms: {catalog: loadConformanceCatalog('forms_catalog_v1_0.json'), version: 'v1.0'},
  simplified: {catalog: loadConformanceCatalog('simplified_catalog_v1_0.json'), version: 'v1.0'},
};

describe('ExpressDecompiler', () => {
  function getCatalogInfo(catalogKey: string): {catalog: SchemaCatalog; version: string} {
    return catalogInfo[catalogKey];
  }

  describe('Writing components and data models', () => {
    it('writes the data model of a createSurface before its components', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'main',
            catalogId: 'conformance/simplified',
            components: [
              {id: 'root', component: 'Card', child: 'body'},
              {id: 'body', component: 'Text', text: {path: '/user/name'}},
            ],
            dataModel: {user: {name: 'Alice', age: 30}},
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("main")\n$/user/age = 30\n$/user/name = "Alice"\nroot = Card(body)\nbody = Text($/user/name)',
      );
    });

    it('writes a function call used as a property value', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {
                id: 'root',
                component: 'Text',
                text: {call: 'formatString', args: {value: 'Welcome, ${/user/name}!'}},
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Text(formatString("Welcome, ${/user/name}!"))',
      );
    });

    it('writes a string holding backslashes and a newline as a raw triple-quoted string', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {id: 'root', component: 'Text', text: 'Path: C:\\Program Files\\App\nLine 2'},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Text(r"""Path: C:\\Program Files\\App\nLine 2""")',
      );
    });

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
  });

  describe('Writing templates', () => {
    it('writes a template over an absolute path', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {
                id: 'root',
                component: 'Column',
                children: {path: '/items', componentId: 'itemTmpl'},
              },
              {id: 'itemTmpl', component: 'Text', text: {path: 'label'}},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Column(_template($/items, itemTmpl))\nitemTmpl = Text($label)',
      );
    });

    it('writes a template over a relative path', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {id: 'root', component: 'Column', children: {path: 'items', componentId: 'itemTmpl'}},
              {id: 'itemTmpl', component: 'Text', text: {path: ''}},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Column(_template($items, itemTmpl))\nitemTmpl = Text($)',
      );
    });
  });

  describe('Writing events', () => {
    it('writes an event without a context', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {id: 'root', component: 'Button', child: 'bText', action: {event: {name: 'click'}}},
              {id: 'bText', component: 'Text', text: 'Click me'},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Button(bText, Event("click"))\nbText = Text("Click me")',
      );
    });

    it('writes an event with a context', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {
                id: 'root',
                component: 'Button',
                child: 'bText',
                action: {
                  event: {name: 'save', context: {userId: 'u123', confirmed: true, count: 5}},
                },
              },
              {id: 'bText', component: 'Text', text: 'Save'},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Button(bText, Event("save", {userId: "u123", confirmed: true, count: 5}))\nbText = Text("Save")',
      );
    });

    it('writes an event with a nested context', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/simplified',
            components: [
              {
                id: 'root',
                component: 'Button',
                child: 'bText',
                action: {event: {name: 'checkout', context: {cart: {itemId: 'i1', qty: 2}}}},
              },
              {id: 'bText', component: 'Text', text: 'Checkout'},
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = Button(bText, Event("checkout", {cart: {itemId: "i1", qty: 2}}))\nbText = Text("Checkout")',
      );
    });
  });

  describe('Writing checks', () => {
    it('writes a check with its default message as a bare check', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/forms',
            components: [
              {
                id: 'root',
                component: 'TextField',
                label: 'Name',
                checks: [
                  {
                    condition: {call: 'required', args: {value: {path: '/name'}}},
                    message: 'Required check failed',
                  },
                ],
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = TextField("Name", ?required)',
      );
    });

    it('writes the arguments of a check after the bound value', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/forms',
            components: [
              {
                id: 'root',
                component: 'TextField',
                label: 'Zip',
                checks: [
                  {
                    condition: {
                      call: 'regex',
                      args: {value: {path: '/zip'}, pattern: '^[0-9]{5}$'},
                    },
                    message: 'Regex check failed',
                  },
                ],
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = TextField("Zip", ?regex("^[0-9]{5}$"))',
      );
    });

    it('writes a custom message as the last check argument', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/forms',
            components: [
              {
                id: 'root',
                component: 'TextField',
                label: 'Zip',
                checks: [
                  {
                    condition: {
                      call: 'regex',
                      args: {value: {path: '/zip'}, pattern: '^[0-9]{5}$'},
                    },
                    message: 'Must be 5 digits',
                  },
                ],
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = TextField("Zip", ?regex("^[0-9]{5}$", "Must be 5 digits"))',
      );
    });

    it('writes several checks as a list', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'conformance/forms',
            components: [
              {
                id: 'root',
                component: 'TextField',
                label: 'Zip',
                checks: [
                  {condition: {call: 'required', args: {value: {path: '/zip'}}}},
                  {
                    condition: {
                      call: 'regex',
                      args: {value: {path: '/zip'}, pattern: '^[0-9]{5}$'},
                    },
                    message: 'Must be 5 digits',
                  },
                ],
              },
            ],
          },
        },
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'root = TextField("Zip", [?required, ?regex("^[0-9]{5}$", "Must be 5 digits")])',
      );
    });
  });

  describe('Writing other messages', () => {
    it('writes a callFunction message as a standalone call', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {version: 'v1.0', callFunction: {call: 'openUrl', args: {url: 'https://example.com/help'}}},
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'openUrl("https://example.com/help")',
      );
    });

    it('writes a standalone call with two arguments', () => {
      const {catalog, version} = getCatalogInfo('forms');
      const messages = [
        {version: 'v1.0', callFunction: {call: 'regex', args: {value: '123', pattern: '^[0-9]+$'}}},
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

    it('merges the messages for one surface into one block', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const messages = [
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: 'conformance/simplified',
            components: [{id: 'root', component: 'Text', text: 'First'}],
          },
        },
        {version: 'v1.0', updateDataModel: {surfaceId: 's1', value: {status: 'loaded'}}},
      ] as unknown as AgentToRendererMessage[];
      expect(new ExpressDecompiler([catalog], version).decompile(messages)).toBe(
        'surface("s1")\n$/status = "loaded"\nroot = Text("First")',
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
        decompileButton({functionCall: {call: 'openUrl', args: 'https://example.com'}}),
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

  describe('4. B3: honour updateDataModel.path with round trip', () => {
    it('decompiles single leaf value at path and round-trips through compiler', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/title',
          value: 'x',
        },
      } as AgentToRendererMessage;

      const notation = decompiler.decompile(msg);
      expect(notation).toBe('surface("s1")\n$/title = "x"');

      // Round trip check
      const parser = new ExpressParser([catalog], 's1', version);
      const recompiled = parser.compile(notation);
      expect(recompiled).toEqual([
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 's1',
            path: '/',
            value: {
              title: 'x',
            },
          },
        },
      ]);
    });

    it('decompiles nested values under non-root path to one assignment per leaf and round-trips', () => {
      const {catalog, version} = getCatalogInfo('simplified');
      const decompiler = new ExpressDecompiler([catalog], version);
      const msg: AgentToRendererMessage = {
        version: 'v1.0',
        updateDataModel: {
          surfaceId: 's1',
          path: '/user',
          value: {
            name: 'Ada',
            city: 'London',
          },
        },
      } as AgentToRendererMessage;

      const notation = decompiler.decompile(msg);
      expect(notation).toBe('surface("s1")\n$/user/city = "London"\n$/user/name = "Ada"');

      // Round trip check
      const parser = new ExpressParser([catalog], 's1', version);
      const recompiled = parser.compile(notation);
      expect(recompiled).toEqual([
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 's1',
            path: '/',
            value: {
              user: {
                city: 'London',
                name: 'Ada',
              },
            },
          },
        },
      ]);
    });
  });
});
