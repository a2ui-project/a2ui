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

import {basicCatalog as codeDefinedBasicCatalogV10} from '@a2ui/web_core/catalogs/basic/v1';
import {describe, expect, it} from 'vitest';

import {A2uiCatalogError} from '../../../../src/errors.js';
import {
  ComponentPruningTransformer,
  FunctionPruningTransformer,
  InMemoryCatalogProvider,
} from '../../../../src/index.js';
import {ExpressCompiler} from '../../../../src/inference-formats/express/compiler.js';
import {ExpressDecompiler} from '../../../../src/inference-formats/express/decompiler.js';
import {
  ExpressForbiddenDatabindingError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressUndefinedRootError,
  ExpressUnknownPropertyError,
  ExpressValidationError,
} from '../../../../src/inference-formats/express/errors.js';
import {Catalog, CatalogApi} from '../../../../src/internal/web-core.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');
const basicCatalogV09 = loadBasicCatalog('v0.9');
const basicCatalogV091 = loadBasicCatalog('v0.9.1');

/** The components of the first message's `createSurface`. */
function createSurfaceComponents(messages: unknown[]): unknown[] {
  return (messages[0] as {createSurface: {components: unknown[]}}).createSurface.components;
}

describe('ExpressCompiler', () => {
  const simplifiedCatalog = loadConformanceCatalog('simplified_catalog_v1_0.json');

  const customCatalog = loadConformanceCatalog('custom_catalog_v1_0.json');
  const formsCatalog = loadConformanceCatalog('forms_catalog_v1_0.json');

  describe('Compiling against the v1.0 basic catalog', () => {
    it('compiles a Text with a variant', () => {
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      expect(compiler.compile('root = Text("Hello world", "body")')).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [{id: 'root', component: 'Text', text: 'Hello world', variant: 'body'}],
          },
        },
      ]);
    });

    it('compiles a Card whose child is declared on its own line', () => {
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      expect(compiler.compile('root = Card(t)\nt = Text("Card body")')).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {id: 'root', component: 'Card', child: 't'},
              {id: 't', component: 'Text', text: 'Card body'},
            ],
          },
        },
      ]);
    });

    it('compiles a Column holding a Text and a Button with an event', () => {
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      expect(
        compiler.compile(
          'root = Column([t1, b1])\nt1 = Text("Title", "body")\nb1 = Button(Text("Click"), action=Event("btn_click", {"id": 1}))',
        ),
      ).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {id: 'root', component: 'Column', children: ['t1', 'b1']},
              {id: 't1', component: 'Text', text: 'Title', variant: 'body'},
              {
                id: 'b1',
                component: 'Button',
                child: 'b1_child',
                action: {event: {name: 'btn_click', context: {id: 1}}},
              },
              {id: 'b1_child', component: 'Text', text: 'Click'},
            ],
          },
        },
      ]);
    });

    it('hoists inline children with indexed ids', () => {
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      expect(compiler.compile('root = Column([Text("Line 1"), Text("Line 2")])')).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
            components: [
              {id: 'root', component: 'Column', children: ['root_children_0', 'root_children_1']},
              {id: 'root_children_0', component: 'Text', text: 'Line 1'},
              {id: 'root_children_1', component: 'Text', text: 'Line 2'},
            ],
          },
        },
      ]);
    });

    it('compiles data assignments alone into one updateDataModel', () => {
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      expect(compiler.compile('$/user/name = "Alice"\n$/user/age = 30')).toEqual([
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'default_surface',
            path: '/',
            value: {user: {name: 'Alice', age: 30}},
          },
        },
      ]);
    });
  });

  describe('Compiling against the v0.9 basic catalog', () => {
    it('splits a block into createSurface and updateComponents', () => {
      const compiler = new ExpressCompiler([basicCatalogV09], 'v0.9');
      expect(compiler.compile('root = Text("Hello v0.9")')).toEqual([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'default_surface',
            components: [{id: 'root', component: 'Text', text: 'Hello v0.9'}],
          },
        },
      ]);
    });

    it('sends the data model after the components', () => {
      const compiler = new ExpressCompiler([basicCatalogV09], 'v0.9');
      expect(
        compiler.compile('root = Column([t])\nt = Text("v0.9 text")\n$/status = "active"'),
      ).toEqual([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
          },
        },
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 'default_surface',
            components: [
              {id: 'root', component: 'Column', children: ['t']},
              {id: 't', component: 'Text', text: 'v0.9 text'},
            ],
          },
        },
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 'default_surface', path: '/', value: {status: 'active'}},
        },
      ]);
    });

    it('compiles data assignments alone into one updateDataModel', () => {
      const compiler = new ExpressCompiler([basicCatalogV09], 'v0.9');
      expect(compiler.compile('$/only/data = 123')).toEqual([
        {
          version: 'v0.9',
          updateDataModel: {surfaceId: 'default_surface', path: '/', value: {only: {data: 123}}},
        },
      ]);
    });

    it('rejects a standalone function call', () => {
      const compiler = new ExpressCompiler([basicCatalogV09], 'v0.9');
      expect(() => compiler.compile('openUrl("https://google.com")')).toThrow(
        ExpressValidationError,
      );
      expect(() => compiler.compile('openUrl("https://google.com")')).toThrow(
        'Standalone function calls are not supported in A2UI v0.9',
      );
    });
  });

  describe('2. Deliberate departures (§5.2 items 4 and 5)', () => {
    it('allows databinding inside nested item schema that admits path (departure 5)', () => {
      // Python's compiler checks _schema_allows_databinding(prop_schema) on the top-level 'tabs' array
      // and throws ExpressForbiddenDatabindingError('Tabs', 'tabs'), rejecting dynamic title inside tab item.
      // TS divergence rationale (plan §5.2 item 5): TS walks alongside the schema positionally.
      // Tabs.tabs items have title of type DynamicString, which admits path, so Tabs([{title: $/t, child: c}]) is valid.
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      const dsl = `
root = Tabs([{title: $/tab_title, child: c}])
c = Text("Content")
`;
      const messages = compiler.compile(dsl);
      expect(messages).toHaveLength(1);
      const msgObj = messages[0] as unknown as Record<string, unknown>;
      const createSurface = msgObj.createSurface as Record<string, unknown>;
      expect(createSurface).toBeDefined();
      const components = createSurface.components as Array<Record<string, unknown>>;
      const tabsComp = components.find(c => c.component === 'Tabs');
      expect(tabsComp).toBeDefined();
      expect(tabsComp?.tabs).toEqual([{title: {'@path': '/tab_title'}, child: 'c'}]);
    });

    it('rejects databinding when nested item schema does NOT admit path (departure 5)', () => {
      // In Tabs.tabs items, 'child' is ComponentId (static string), which does NOT admit path.
      const compiler = new ExpressCompiler([basicCatalogV10], 'v1.0');
      const dsl = `
root = Tabs([{title: "Static Title", child: $/dynamic_child}])
`;
      expect(() => compiler.compile(dsl)).toThrow(ExpressForbiddenDatabindingError);
      try {
        compiler.compile(dsl);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExpressForbiddenDatabindingError);
        expect((err as ExpressForbiddenDatabindingError).compName).toBe('Tabs');
        expect((err as ExpressForbiddenDatabindingError).propName).toBe('tabs');
      }
    });
  });

  describe('3. Specific error cases (§Wave 2a item 3)', () => {
    it('throws ExpressSyntaxError on lexer error', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = @Text("Hello")')).toThrow(ExpressSyntaxError);
      try {
        compiler.compile('root = @Text("Hello")');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExpressSyntaxError);
        const synErr = err as ExpressSyntaxError;
        expect(synErr.isLexer).toBe(true);
        expect(synErr.line).toBe(1);
        expect(synErr.column).toBe(7);
        expect(synErr.message).toContain("token recognition error at: '@'");
      }
    });

    it('throws ExpressParseError wrapping ExpressSyntaxError on parser error', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = Text(')).toThrow(ExpressParseError);
      try {
        compiler.compile('root = Text(');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExpressParseError);
        const parseErr = err as ExpressParseError;
        expect(parseErr.message).toContain(
          'Failed to parse expression: Syntax error at line 1:12:',
        );
        expect(parseErr.cause).toBeInstanceOf(ExpressSyntaxError);
        const cause = parseErr.cause as ExpressSyntaxError;
        expect(cause.isLexer).toBe(false);
        expect(cause.line).toBe(1);
        expect(cause.column).toBe(12);
      }
    });

    it('throws ExpressUndefinedRootError on empty block', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('')).toThrow(ExpressUndefinedRootError);
    });

    it('throws ExpressUnknownPropertyError on unknown property', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = Text("hi", unknownProp="val")')).toThrow(
        ExpressUnknownPropertyError,
      );
    });

    it('throws ExpressValidationError on enum violation, listing the allowed values', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = Text("hi", "invalid_variant")')).toThrow(
        ExpressValidationError,
      );
      try {
        compiler.compile('root = Text("hi", "invalid_variant")');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExpressValidationError);
        expect((err as Error).message).toBe(
          "Value 'invalid_variant' is not a valid enum choice for property 'variant' of component 'Text'. Allowed values are: ['body', 'caption']",
        );
      }
    });

    it('throws ExpressForbiddenDatabindingError on static property receiving data binding', () => {
      const compiler = new ExpressCompiler([customCatalog], 'v1.0');
      expect(() => compiler.compile('root = Chart([1, 2], $/caption)')).toThrow(
        ExpressForbiddenDatabindingError,
      );
    });

    it('suppresses syntax errors and returns empty statements when isFinal is false (sanctioned swallow)', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      // When isFinal=false, syntax error in incomplete input is swallowed and statements becomes []
      // With no statements, scopes is [] which raises ExpressUndefinedRootError
      expect(() => compiler.compile('root = Text(', 'default_surface', false)).toThrow(
        ExpressUndefinedRootError,
      );
    });
  });

  describe('_template argument errors', () => {
    it('shows a non-path first argument as JSON', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() =>
        compiler.compile('root = Column(_template([1, "a", null], item))\nitem = Text("x")'),
      ).toThrow(
        new ExpressParseError(
          'The first argument to _template must be a dynamic data binding path (prefixed by $), got: [1,"a",null]',
        ),
      );
    });
  });

  describe('Statement handling', () => {
    it('compiles statements separated by semicolons on one line', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const messages = compiler.compile('child = Text("Hi"); root = Column([child])');
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: simplifiedCatalog.id,
            components: [
              {id: 'child', component: 'Text', text: 'Hi'},
              {id: 'root', component: 'Column', children: ['child']},
            ],
          },
        },
      ]);
    });

    it('keeps the complete data statements of a truncated block when not final', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const messages = compiler.compile(
        '$/foo = 123\n$/bar = """unclosed string...\n',
        'default_surface',
        false,
      );
      expect(messages).toEqual([
        {
          version: 'v1.0',
          updateDataModel: {surfaceId: 'default_surface', path: '/', value: {foo: 123}},
        },
      ]);
    });

    it('keeps the complete components of a truncated block when not final', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const messages = compiler.compile(
        'root = Column([title])\ntitle = Text("Hello")\nfooter = Text("unfin',
        'default_surface',
        false,
      );
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: simplifiedCatalog.id,
            components: [
              {id: 'root', component: 'Column', children: ['title']},
              {id: 'title', component: 'Text', text: 'Hello'},
            ],
          },
        },
      ]);
    });
  });

  describe('Protocol version lines', () => {
    function versionsOf(messages: unknown[]): unknown[] {
      return messages.map(message => (message as {version: string}).version);
    }

    it('compiles a v0.9 catalog for a v0.9.1 target', () => {
      const compiler = new ExpressCompiler(basicCatalogV09, 'v0.9.1');
      const messages = compiler.compile('root = Text("Hi")', 'surf_v091');
      expect(versionsOf(messages)).toEqual(['v0.9.1', 'v0.9.1']);
    });

    it('compiles a catalog that declares v0.9.1', () => {
      const compiler = new ExpressCompiler(basicCatalogV091);
      expect(compiler.version).toBe('v0.9.1');
      const messages = compiler.compile('root = Text("Hi")');
      expect(versionsOf(messages)).toEqual(['v0.9.1', 'v0.9.1']);
    });

    it('compiles a v0.9.1 catalog for a v0.9 target', () => {
      const messages = new ExpressCompiler(basicCatalogV091, 'v0.9').compile('root = Text("Hi")');
      expect(versionsOf(messages)).toEqual(['v0.9', 'v0.9']);
    });

    it('accepts a per-call version on the same line', () => {
      const compiler = new ExpressCompiler(basicCatalogV09);
      const messages = compiler.compile('root = Text("Hi")', 's', true, 'v0.9.1');
      expect(versionsOf(messages)).toEqual(['v0.9.1', 'v0.9.1']);
    });

    it('rejects a v1.0 target for a v0.9 catalog', () => {
      expect(() => new ExpressCompiler(basicCatalogV09, 'v1.0')).toThrow(A2uiCatalogError);
    });

    it('rejects a per-call v1.0 version for a v0.9 catalog', () => {
      const compiler = new ExpressCompiler(basicCatalogV09);
      expect(() => compiler.compile('root = Text("Hi")', 's', true, 'v1.0')).toThrow(
        A2uiCatalogError,
      );
    });
  });

  describe('Multiple Catalogs', () => {
    const labelsDoc: Record<string, unknown> = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      catalogId: 'test/labels',
      protocolVersion: '1.0',
      components: {
        Text: {
          type: 'object',
          properties: {component: {const: 'Text'}, label: {type: 'string'}},
          required: ['component', 'label'],
        },
      },
      functions: {
        formatString: {
          type: 'object',
          properties: {
            call: {const: 'formatString'},
            args: {
              type: 'object',
              properties: {template: {type: 'string'}},
              required: ['template'],
            },
          },
        },
        required: {
          type: 'object',
          properties: {
            call: {const: 'required'},
            args: {
              type: 'object',
              properties: {value: {type: 'string'}, hint: {type: 'string'}},
              required: ['value'],
            },
          },
        },
      },
    };
    const labelsCatalog = Catalog.fromJson(labelsDoc);

    it('resolves unique components, functions, and checks across active catalogs and omits createSurface.catalogId', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog, customCatalog, formsCatalog]);
      const messages = compiler.compile(
        'surface("dashboard")\n' +
          'root = Column([g, f])\n' +
          'g = Gauge(0.75)\n' +
          'f = TextField(formatString("Zip"), $/zip, _, [?regex(r"^[0-9]{5}$", "Must be 5 digits")])',
      );
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'dashboard',
            components: [
              {
                id: 'root',
                component: 'Column',
                catalogId: simplifiedCatalog.id,
                children: ['g', 'f'],
              },
              {
                id: 'g',
                component: 'Gauge',
                catalogId: customCatalog.id,
                value: 0.75,
              },
              {
                id: 'f',
                component: 'TextField',
                catalogId: formsCatalog.id,
                label: {
                  '@call': 'formatString',
                  catalogId: simplifiedCatalog.id,
                  args: {value: 'Zip'},
                },
                value: {'@path': '/zip'},
                checks: [
                  {
                    condition: {
                      '@call': 'regex',
                      catalogId: formsCatalog.id,
                      args: {value: {'@path': '/zip'}, pattern: '^[0-9]{5}$'},
                    },
                    message: 'Must be 5 digits',
                  },
                ],
              },
            ],
          },
        },
      ]);
    });

    it('disambiguates shared component, function, and check names with catalogId', () => {
      const compiler = new ExpressCompiler([formsCatalog, simplifiedCatalog, labelsCatalog]);
      const messages = compiler.compile(
        'root = Column([t1, t2, tf])\n' +
          `t1 = Text(formatString("Hello", catalogId="${simplifiedCatalog.id}"), catalogId="${simplifiedCatalog.id}")\n` +
          't2 = Text(formatString("World", catalogId="test/labels"), catalogId="test/labels")\n' +
          'tf = TextField("Name", $/name, _, [?required("Field required", {catalogId: "test/labels"})])',
      );
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            components: [
              {
                id: 'root',
                component: 'Column',
                catalogId: simplifiedCatalog.id,
                children: ['t1', 't2', 'tf'],
              },
              {
                id: 't1',
                component: 'Text',
                catalogId: simplifiedCatalog.id,
                text: {
                  '@call': 'formatString',
                  catalogId: simplifiedCatalog.id,
                  args: {value: 'Hello'},
                },
              },
              {
                id: 't2',
                component: 'Text',
                catalogId: 'test/labels',
                label: {
                  '@call': 'formatString',
                  catalogId: 'test/labels',
                  args: {template: 'World'},
                },
              },
              {
                id: 'tf',
                component: 'TextField',
                catalogId: formsCatalog.id,
                label: 'Name',
                value: {'@path': '/name'},
                checks: [
                  {
                    condition: {
                      '@call': 'required',
                      catalogId: 'test/labels',
                      args: {value: {'@path': '/name'}, hint: 'Field required'},
                    },
                    message: 'Required check failed',
                  },
                ],
              },
            ],
          },
        },
      ]);
    });

    it('rejects ambiguous component or function names without catalogId', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog, labelsCatalog]);
      expect(() => compiler.compile('root = Text("hi")')).toThrow(ExpressValidationError);
      expect(() => compiler.compile('root = Text("hi")')).toThrow(
        "Component 'Text' is defined in several catalogs: 'conformance/simplified', 'test/labels'. Name the catalog to use with a catalogId argument.",
      );

      expect(() =>
        compiler.compile(`root = Text(formatString("hi"), catalogId="${simplifiedCatalog.id}")`),
      ).toThrow(
        "Function 'formatString' is defined in several catalogs: 'conformance/simplified', 'test/labels'. Name the catalog to use with a catalogId argument.",
      );
    });

    it('rejects unknown catalogId or catalogId on surface(...) when multiple catalogs are active', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog, customCatalog]);
      expect(() => compiler.compile('root = Text("hi", catalogId="unknown/cat")')).toThrow(
        "Component 'Text' targets unknown catalog 'unknown/cat'. Active catalogs: 'conformance/simplified', 'conformance/custom'.",
      );
      expect(() =>
        compiler.compile(`surface("s1", catalogId="${simplifiedCatalog.id}")\nroot = Text("hi")`),
      ).toThrow(
        `surface() names catalog '${simplifiedCatalog.id}', but a surface names no catalog when several catalogs are active.`,
      );
    });

    it('supports surface sendDataModel, surface update, component id, and standalone call functionCallId', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog]);
      const messages = compiler.compile(
        'surface("s1", sendDataModel=true)\n' +
          'root = Card(child_var)\n' +
          'child_var = Text("Hello", id="custom-child-id")\n' +
          'surface("s1", update=true)\n' +
          'root = Text("Updated root")\n' +
          'openUrl("https://example.com", functionCallId="custom-call-1")\n' +
          'deleteSurface("s2")',
      );
      expect(messages).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            catalogId: simplifiedCatalog.id,
            sendDataModel: true,
            components: [
              {id: 'root', component: 'Card', child: 'custom-child-id'},
              {id: 'custom-child-id', component: 'Text', text: 'Hello'},
            ],
          },
        },
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'root', component: 'Text', text: 'Updated root'}],
          },
        },
        {
          version: 'v1.0',
          callRendererFunction: {
            functionCallId: 'custom-call-1',
            callFunction: {
              catalogId: simplifiedCatalog.id,
              '@call': 'openUrl',
              args: {url: 'https://example.com'},
            },
          },
        },
        {
          version: 'v1.0',
          deleteSurface: {
            surfaceId: 's2',
          },
        },
      ]);
    });

    it('determines createSurface vs updateComponents from compiled component id="root"', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog]);

      expect(compiler.compile('x = Text("x", id="root")')).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 'default_surface',
            catalogId: simplifiedCatalog.id,
            components: [{id: 'root', component: 'Text', text: 'x'}],
          },
        },
      ]);

      expect(compiler.compile('root = Text("x", id="main")')).toEqual([
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'default_surface',
            components: [{id: 'main', component: 'Text', text: 'x'}],
          },
        },
      ]);

      expect(compiler.compile('surface("s1")\nroot = Text("x", id="main")')).toEqual([
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 's1',
            components: [{id: 'main', component: 'Text', text: 'x'}],
          },
        },
      ]);
    });

    it('inlines a variable holding a function call with catalogId and rejects invalid catalogId overrides on variables', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog, customCatalog]);

      expect(
        compiler.compile(
          'surface("s1")\n' +
            'root = Chart([1, 2], total)\n' +
            `total = formatString("Total: \${/total}", catalogId="${simplifiedCatalog.id}")`,
        ),
      ).toEqual([
        {
          version: 'v1.0',
          createSurface: {
            surfaceId: 's1',
            components: [
              {
                id: 'root',
                component: 'Chart',
                catalogId: customCatalog.id,
                values: [1, 2],
                caption: {
                  '@call': 'formatString',
                  catalogId: simplifiedCatalog.id,
                  args: {value: 'Total: ${/total}'},
                },
              },
            ],
          },
        },
      ]);

      expect(() =>
        compiler.compile(
          'surface("s1")\n' +
            'root = Chart([1, 2], total)\n' +
            `total = percent(75, catalogId="${simplifiedCatalog.id}")`,
        ),
      ).toThrow(/percent/);

      expect(() =>
        compiler.compile(
          'surface("s1")\n' +
            'root = Chart([1, 2], "Total")\n' +
            'total = formatString("Total", catalogId="conformance/missing")',
        ),
      ).toThrow(/conformance\/missing/);

      expect(() =>
        compiler.compile(
          'surface("s1")\n' +
            'root = Chart([1, 2], "Total")\n' +
            `act = Event("click", catalogId="${simplifiedCatalog.id}")`,
        ),
      ).toThrow(/Event/);
    });
  });

  describe('Catalogs read through their model', () => {
    const columnSource =
      'root = Column([t1, b1])\nt1 = Text("Title", "body")\nb1 = Button(Text("Click"), action=Event("btn_click", {"id": 1}))';

    it('compiles against a catalog defined in code as against its published document', () => {
      const codeDefined = codeDefinedBasicCatalogV10 as unknown as CatalogApi;
      const fromCode = new ExpressCompiler([codeDefined], 'v1.0').compile(columnSource);
      const fromDocument = new ExpressCompiler([basicCatalogV10], 'v1.0').compile(columnSource);
      expect(fromCode).toEqual(fromDocument);
      expect(createSurfaceComponents(fromCode)).toHaveLength(4);
    });

    it('decompiles against a catalog defined in code', () => {
      const codeDefined = codeDefinedBasicCatalogV10 as unknown as CatalogApi;
      const messages = new ExpressCompiler([codeDefined], 'v1.0').compile(columnSource);
      const dsl = new ExpressDecompiler([codeDefined], 'v1.0').decompile(messages[0]);
      expect(new ExpressCompiler([codeDefined], 'v1.0').compile(dsl)).toEqual(messages);
    });

    it.each([
      ['loaded from a document', () => basicCatalogV10],
      ['defined in code', () => codeDefinedBasicCatalogV10 as unknown as CatalogApi],
    ])('compiles against a pruned catalog %s', (_, source) => {
      const pruned = new FunctionPruningTransformer([]).transform(
        new ComponentPruningTransformer(['Column', 'Text']).transform(source()),
      );
      const compiler = new ExpressCompiler([pruned], 'v1.0');
      expect(
        createSurfaceComponents(compiler.compile('root = Column([t])\nt = Text("hi")')),
      ).toEqual([
        {id: 'root', component: 'Column', children: ['t']},
        {id: 't', component: 'Text', text: 'hi'},
      ]);
      expect(() => compiler.compile('root = Button(Text("Click"))')).toThrow(
        ExpressValidationError,
      );
    });

    it('ignores changes the caller makes to the document after loading', () => {
      const document: Record<string, unknown> = {
        catalogId: 'test/mutable',
        protocolVersion: '1.0',
        components: {
          Label: {
            type: 'object',
            properties: {component: {const: 'Label'}, text: {type: 'string'}},
            required: ['component', 'text'],
          },
        },
      };
      const catalog = new InMemoryCatalogProvider(document).load();
      const label = (document.components as Record<string, Record<string, unknown>>).Label;
      label.properties = {component: {const: 'Label'}, caption: {type: 'string'}};
      label.required = ['component', 'caption'];

      const messages = new ExpressCompiler([catalog], 'v1.0').compile('root = Label("hi")');
      expect(createSurfaceComponents(messages)).toEqual([
        {id: 'root', component: 'Label', text: 'hi'},
      ]);
    });
  });
});
