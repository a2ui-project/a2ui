/*
 * Copyright 2026 Google LLC
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

import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {Catalog} from '../../../../src/internal/web_core.js';
import {basicCatalog, type SchemaCatalog} from '../../../../src/types.js';
import {registerCatalogDocument} from '../../../../src/utils/catalog_document.js';
import {A2uiCatalogError} from '../../../../src/errors.js';
import {ExpressCompiler} from '../../../../src/inference_formats/express/compiler.js';
import {ExpressDecompiler} from '../../../../src/inference_formats/express/decompiler.js';
import {
  ExpressDuplicateParamError,
  ExpressDuplicatePropertyError,
  ExpressForbiddenDatabindingError,
  ExpressInvalidParamError,
  ExpressParseError,
  ExpressSyntaxError,
  ExpressUndefinedRootError,
  ExpressUnknownComponentError,
  ExpressMissingRequiredPropertyError,
  ExpressUnknownFunctionError,
  ExpressUnknownPropertyError,
  ExpressValidationError,
  ExpressIdCollisionError,
  ExpressUnknownCatalogError,
} from '../../../../src/inference_formats/express/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface ExpectedSuccess {
  status: 'success';
  messages: unknown[];
}

interface ExpectedError {
  status: 'error';
  error: string;
  message: string;
}

interface CorpusEntry {
  name: string;
  catalog: 'simplified' | 'forms' | 'custom' | 'basic_v1_0' | 'basic_v0_9';
  version: string;
  input: string;
  expected: ExpectedSuccess | ExpectedError;
}

const errorClasses: Record<string, new (...args: never[]) => Error> = {
  ExpressUndefinedRootError,
  ExpressParseError,
  ExpressUnknownComponentError,
  ExpressMissingRequiredPropertyError,
  ExpressUnknownFunctionError,
  ExpressUnknownPropertyError,
  ExpressValidationError,
  ExpressForbiddenDatabindingError,
  ExpressSyntaxError,
  ExpressDuplicatePropertyError,
  ExpressInvalidParamError,
  ExpressDuplicateParamError,
  ExpressUnknownCatalogError,
};

describe('ExpressCompiler', () => {
  // Load and register catalog fixtures as required by spec §Wave 2a
  const simplifiedDoc = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'simplified_catalog_v1_0.json'), 'utf8'),
  ) as Record<string, unknown>;
  const simplifiedCatalog = Catalog.fromSchema(simplifiedDoc);
  registerCatalogDocument(simplifiedCatalog, simplifiedDoc);

  const formsDoc = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'forms_catalog_v1_0.json'), 'utf8'),
  ) as Record<string, unknown>;
  const formsCatalog = Catalog.fromSchema(formsDoc);
  registerCatalogDocument(formsCatalog, formsDoc);

  const customDoc = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, 'custom_catalog_v1_0.json'), 'utf8'),
  ) as Record<string, unknown>;
  const customCatalog = Catalog.fromSchema(customDoc);
  registerCatalogDocument(customCatalog, customDoc);

  const basicCatalogV10 = basicCatalog('v1.0');
  const basicCatalogV09 = basicCatalog('v0.9');

  const catalogs: Record<string, SchemaCatalog> = {
    simplified: simplifiedCatalog,
    forms: formsCatalog,
    custom: customCatalog,
    basic_v1_0: basicCatalogV10,
    basic_v0_9: basicCatalogV09,
  };

  describe('1. PARITY CORPUS (57 cases evaluated against Python oracle)', () => {
    // See tests/unit/inference_formats/express/fixtures/README.md for generation instructions
    const corpusPath = path.join(FIXTURES_DIR, 'compiler_corpus.json');
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8')) as CorpusEntry[];

    const overridesPath = path.join(FIXTURES_DIR, 'conformance_overrides.json');
    const overridesAll = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
    const overrides = overridesAll['compiler_corpus.json'] || {};

    it('every override names a case in compiler_corpus.json', () => {
      const names = new Set(corpus.map(c => c.name));
      for (const name of Object.keys(overrides)) {
        expect(names.has(name), `override '${name}' matches no case`).toBe(true);
      }
    });

    for (const entry of corpus) {
      it(`matches oracle on: ${entry.name}`, () => {
        const cat = catalogs[entry.catalog];
        expect(cat, `Catalog ${entry.catalog} must be registered`).toBeDefined();

        const override = overrides[entry.name];
        const expected = override ? override.expected : entry.expected;

        const compiler = new ExpressCompiler([cat], entry.version);
        if (expected.status === 'success') {
          const actual = compiler.compile(entry.input);
          expect(actual).toEqual(expected.messages);
        } else {
          const expectedCls = errorClasses[expected.error];
          expect(expectedCls, `Unknown error class ${expected.error}`).toBeDefined();

          expect(() => compiler.compile(entry.input)).toThrow(expectedCls);
          try {
            compiler.compile(entry.input);
          } catch (err: unknown) {
            expect(err).toBeInstanceOf(expectedCls);
            if (expectedCls === ExpressSyntaxError) {
              const synErr = err as ExpressSyntaxError;
              const pyStrMsg = `${synErr.message} (line ${synErr.line})`;
              expect(pyStrMsg).toBe(expected.message);
            } else {
              expect((err as Error).message).toBe(expected.message);
            }
          }
        }
      });
    }
  });

  describe('Follow-up 2: ExpressIdCollisionError', () => {
    it('throws ExpressIdCollisionError when an inline id collides with a declared variable', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const dsl = `
root_child = Text("c2")
root = Card(Text("c1"))
`;
      expect(() => compiler.compile(dsl)).toThrow(ExpressIdCollisionError);
    });

    it('throws ExpressIdCollisionError when inline array items collide with declared variables', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const dsl = `
root_children_1 = Text("conflict")
root = Column([Text("a"), Text("b")])
`;
      expect(() => compiler.compile(dsl)).toThrow(ExpressIdCollisionError);
    });
  });

  describe('2. Deliberate departures (§5.2 items 4 and 5)', () => {
    it('throws ExpressValidationError when checks are written on an uncheckable component (departure 4)', () => {
      // Oracle output: Python silently emits {"id": "root", "component": "Text", "text": "hi", "checks": [...]}
      // TS divergence rationale (plan §5.2 item 4 / KNOWN_GAPS): Writing checks on a component that does not
      // declare a check-rule property violates the schema. TS explicitly rejects this.
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const dsl = 'root = Text("hi", [?required])';

      expect(() => compiler.compile(dsl)).toThrow(ExpressValidationError);
      try {
        compiler.compile(dsl);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExpressValidationError);
        const valErr = err as ExpressValidationError;
        expect(valErr.message).toBe("Component 'Text' does not accept checks.");
        expect(valErr.helpMessage).toBe(
          'Remove the check expressions, or use a component whose schema declares a list of CheckRule.',
        );
      }
    });

    it('allows databinding inside nested item schema that admits path (departure 5)', () => {
      // Oracle output: Python checks not _schema_allows_databinding(prop_schema) on the top-level 'tabs' array
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
      expect(tabsComp?.tabs).toEqual([{title: {path: '/tab_title'}, child: 'c'}]);
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

    it('compiles block with component assignments but no root into updateComponents', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      const messages = compiler.compile('some_var = Text("Hi")');
      expect(messages).toEqual([
        {
          version: 'v1.0',
          updateComponents: {
            surfaceId: 'default_surface',
            components: [{id: 'some_var', component: 'Text', text: 'Hi'}],
          },
        },
      ]);
    });

    it('throws ExpressUnknownPropertyError on unknown property', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = Text("hi", unknownProp="val")')).toThrow(
        ExpressUnknownPropertyError,
      );
    });

    it('throws ExpressDuplicatePropertyError on duplicate property', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() => compiler.compile('root = Text("hi", text="duplicate")')).toThrow(
        ExpressDuplicatePropertyError,
      );
    });

    it('throws ExpressInvalidParamError on invalid function argument keyword', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() =>
        compiler.compile(
          'root = Button(Text("hi"), action=openUrl("https://example.com", badArg=1))',
        ),
      ).toThrow(ExpressInvalidParamError);
    });

    it('throws ExpressDuplicateParamError on duplicate function argument', () => {
      const compiler = new ExpressCompiler([simplifiedCatalog], 'v1.0');
      expect(() =>
        compiler.compile(
          'root = Button(Text("hi"), action=openUrl("https://example.com", url="https://other.com"))',
        ),
      ).toThrow(ExpressDuplicateParamError);
    });

    it('throws ExpressValidationError on enum violation with exact Python formatting', () => {
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

    it('throws ExpressValidationError for standalone function calls on v0.9', () => {
      const compiler = new ExpressCompiler([basicCatalog('v0.9')], 'v0.9');
      expect(() => compiler.compile('openUrl("https://example.com")')).toThrow(
        ExpressValidationError,
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

    it('rejects a component from another active catalog', () => {
      const compiler = new ExpressCompiler([basicCatalogV10, customCatalog]);
      expect(() =>
        compiler.compile(`surface("s1", catalogId="${basicCatalogV10.id}")\nroot = Gauge(30)`),
      ).toThrow(ExpressUnknownComponentError);
    });

    it('throws ExpressUnknownCatalogError for a catalog that is not active', () => {
      const compiler = new ExpressCompiler([basicCatalogV10]);
      expect(() =>
        compiler.compile('surface("main", catalogId="unknown")\nroot = Text("hi")'),
      ).toThrow(ExpressUnknownCatalogError);
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
