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

import {A2uiCatalogError} from '../../../../src/errors.js';
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
import {Catalog} from '../../../../src/internal/web-core.js';
import {registerCatalogDocument} from '../../../../src/utils/catalog-document.js';
import {loadBasicCatalog} from '../../../helpers/basic-catalogs.js';
import {loadConformanceCatalog} from '../../../helpers/conformance-catalogs.js';

const basicCatalogV10 = loadBasicCatalog('v1.0');
const basicCatalogV09 = loadBasicCatalog('v0.9');
const basicCatalogV091 = loadBasicCatalog('v0.9.1');

describe('ExpressCompiler', () => {
  const simplifiedCatalog = loadConformanceCatalog('simplified_catalog_v1_0.json');

  const customCatalog = loadConformanceCatalog('custom_catalog_v1_0.json');

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
      expect(() => compiler.compile('root = Text(', 'default_surface', '', false)).toThrow(
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
        '',
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
        '',
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
      const messages = compiler.compile('root = Text("Hi")', 's', '', true, 'v0.9.1');
      expect(versionsOf(messages)).toEqual(['v0.9.1', 'v0.9.1']);
    });

    it('rejects a v1.0 target for a v0.9 catalog', () => {
      expect(() => new ExpressCompiler(basicCatalogV09, 'v1.0')).toThrow(A2uiCatalogError);
    });

    it('rejects a per-call v1.0 version for a v0.9 catalog', () => {
      const compiler = new ExpressCompiler(basicCatalogV09);
      expect(() => compiler.compile('root = Text("Hi")', 's', '', true, 'v1.0')).toThrow(
        A2uiCatalogError,
      );
    });
  });

  describe('Multiple Catalogs', () => {
    // A second catalog that also defines `Text`, with a different property, so a
    // test can tell which catalog a block compiled against.
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
      functions: {},
    };
    const labelsCatalog = Catalog.fromSchema(labelsDoc);
    registerCatalogDocument(labelsCatalog, labelsDoc);

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function createSurfaceOf(message: unknown): Record<string, unknown> {
      return (message as {createSurface: Record<string, unknown>}).createSurface;
    }

    it('looks components up only in the catalog the surface line names', () => {
      const compiler = new ExpressCompiler([basicCatalogV10, labelsCatalog]);
      const messages = compiler.compile(
        `surface("s1", catalogId="${basicCatalogV10.id}")\nroot = Text("hello")\n` +
          'surface("s2", catalogId="test/labels")\nroot = Text("hello")',
      );
      expect(messages.map(createSurfaceOf)).toEqual([
        {
          surfaceId: 's1',
          catalogId: basicCatalogV10.id,
          components: [{id: 'root', component: 'Text', text: 'hello'}],
        },
        {
          surfaceId: 's2',
          catalogId: 'test/labels',
          components: [{id: 'root', component: 'Text', label: 'hello'}],
        },
      ]);
    });

    it('uses the first catalog and warns when a block names none', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const compiler = new ExpressCompiler([basicCatalogV10, labelsCatalog]);
      const messages = compiler.compile('root = Text("hi")');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain(`'${basicCatalogV10.id}'`);
      expect(createSurfaceOf(messages[0]).catalogId).toBe(basicCatalogV10.id);
    });

    it('does not warn with a single catalog', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new ExpressCompiler(basicCatalogV10).compile('root = Text("hi")');
      expect(warn).not.toHaveBeenCalled();
    });

    it('decompiles each message with the catalog it names', () => {
      const decompiler = new ExpressDecompiler([basicCatalogV10, labelsCatalog], 'v1.0');
      const dsl = decompiler.decompile({
        version: 'v1.0',
        createSurface: {
          surfaceId: 's2',
          catalogId: 'test/labels',
          components: [{id: 'root', component: 'Text', label: 'hello'}],
        },
      });
      expect(dsl).toBe('surface("s2", catalogId="test/labels")\nroot = Text("hello")');
    });

    it('refuses to decompile messages for a catalog it does not have', () => {
      const decompiler = new ExpressDecompiler(basicCatalogV10, 'v1.0');
      expect(() =>
        decompiler.decompile({
          version: 'v1.0',
          createSurface: {surfaceId: 's', catalogId: 'test/labels', components: []},
        }),
      ).toThrow(A2uiCatalogError);
    });
  });
});
