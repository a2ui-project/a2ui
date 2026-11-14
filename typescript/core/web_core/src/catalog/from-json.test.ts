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

import * as assert from 'node:assert';
import {promises as fsPromises, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';

import {
  A2uiCatalogError,
  A2uiConfigurationError,
  A2uiValidationError,
  NO_VALIDATOR_MESSAGE,
} from '../errors.js';
import {objectProperties} from '../schema-engine/nav.js';
import type {CatalogSchema, JsonSchemaValidator} from '../schema-engine/types.js';
import {testValidator} from '../test/validator.js';
import {STRICT_VALIDATION} from '../validation/integrity-checker.js';
import {PayloadValidator} from '../validation/payload-validator.js';
import {entrySchema} from './entry-schema.js';
import {Catalog, type CatalogApi} from './types.js';

const repo = (path: string) => resolve(process.cwd(), '../../..', path);
const readJson = (path: string) => JSON.parse(readFileSync(repo(path), 'utf-8'));

function load(document: Record<string, unknown>, protocolVersion?: string): CatalogApi {
  return Catalog.fromJson(document, protocolVersion, undefined, {validator: testValidator});
}

/** Validates `value` with an entry's schema. */
function validate(schema: unknown, value: unknown) {
  const result = (schema as CatalogSchema)['~standard'].validate(value);
  assert.ok(!(result instanceof Promise));
  return result;
}

const accepts = (schema: unknown, value: unknown) => !validate(schema, value).issues;

/** The property names discovery reads from a loaded component, across `allOf`. */
function declaredKeys(catalog: CatalogApi, name: string): string[] {
  const {node, doc} = entrySchema(catalog.components.get(name)!, 'component', catalog)!.cursor;
  return Object.keys(objectProperties(node, doc)?.properties ?? {});
}

/** A validator that counts the schemas it compiles. */
function countingValidator(): JsonSchemaValidator & {compiled: number} {
  const counting = {
    compiled: 0,
    compile: ((schema, opts) => {
      counting.compiled++;
      return testValidator.compile(schema, opts);
    }) as JsonSchemaValidator['compile'],
  };
  return counting;
}

describe('Catalog.fromJson', () => {
  it('round-trips the v1.0 basic catalog: toJson writes the definitions as loaded', () => {
    const document = readJson('catalogs/basic/v1/catalog.json');
    const out = load(document).toJson();
    assert.deepStrictEqual(out['components'], document.components);
    assert.deepStrictEqual(out['functions'], document.functions);
    assert.deepStrictEqual(out, document);
    const text = (out['components'] as Record<string, {properties: {text: {$ref: string}}}>)[
      'Text'
    ];
    assert.strictEqual(text.properties.text.$ref, 'common_types.json#/$defs/DynamicString');
  });

  it('requires a validator', () => {
    const noValidator = (opts: unknown) => () =>
      Catalog.fromJson({catalogId: 'c', components: {}}, undefined, undefined, opts as never);
    for (const opts of [undefined, {}]) {
      assert.throws(
        noValidator(opts),
        (err: unknown) =>
          err instanceof A2uiConfigurationError && err.message.startsWith(NO_VALIDATOR_MESSAGE),
      );
    }
  });

  it('compiles every entry once, as the catalog loads', () => {
    const validator = countingValidator();
    const catalog = Catalog.fromJson(
      readJson('catalogs/basic/v1/catalog.json'),
      undefined,
      undefined,
      {validator},
    );
    const entries =
      catalog.components.size + catalog.functions.size + (catalog.themeSchema ? 1 : 0);
    assert.strictEqual(validator.compiled, entries);
    const text = catalog.components.get('Text')!.schema;
    assert.ok(accepts(text, {text: 'Hello'}));
    assert.ok(accepts(text, {text: {'@path': '/user/name'}}));
    assert.ok(!accepts(text, {text: 42}));
    assert.strictEqual(validator.compiled, entries, 'validating compiles nothing more');
  });

  describe('validates with the catalog document', () => {
    it("validates a component's properties without its envelope fields", () => {
      const catalog = load(readJson('specification/v0_9_1/catalogs/basic/catalog.json'), '0.9');
      const text = catalog.components.get('Text')!.schema;
      assert.ok(accepts(text, {text: 'Hello'}));
      assert.ok(accepts(text, {text: {path: '/user/name'}}));
      // `weight` from the catalog's own `$defs`, `accessibility` from the common types.
      assert.ok(accepts(text, {text: 'Hello', weight: 2}));
      assert.ok(accepts(text, {text: 'Hello', accessibility: {label: 'Heading'}}));
      assert.ok(!accepts(text, {text: 'Hello', accessibility: {label: 7}}));
      assert.ok(!accepts(text, {}), 'text is required');
      assert.ok(accepts(catalog.components.get('Row')!.schema, {children: ['c1', 'c2']}));
      const keys = declaredKeys(catalog, 'Text');
      assert.ok(keys.includes('text') && keys.includes('weight') && keys.includes('accessibility'));
      assert.ok(!keys.includes('component'));
    });

    it('validates the Checkable mixin of the common types', () => {
      const catalog = load(readJson('specification/v0_9_1/catalogs/basic/catalog.json'));
      const button = catalog.components.get('Button')!.schema;
      const action = {event: {name: 'submit'}};
      assert.ok(
        accepts(button, {
          child: 'txt1',
          action,
          checks: [{condition: {path: '/form/valid'}, message: 'Required'}],
        }),
      );
      assert.ok(!accepts(button, {child: 'txt1', action, checks: 'always'}));
      for (const name of ['TextField', 'CheckBox', 'ChoicePicker', 'Slider', 'DateTimeInput']) {
        assert.ok(declaredKeys(catalog, name).includes('checks'), `${name} declares checks`);
      }
    });

    it('rejects a value two oneOf branches accept, as JSON Schema does', () => {
      const catalog = load({
        catalogId: 'one-of',
        components: {
          Input: {
            type: 'object',
            properties: {value: {oneOf: [{type: 'string'}, {type: 'string', maxLength: 3}]}},
            required: ['value'],
          },
        },
      });
      const input = catalog.components.get('Input')!.schema;
      assert.ok(accepts(input, {value: 'long enough'}), 'only the first branch accepts it');
      assert.ok(!accepts(input, {value: 'ab'}), 'both branches accept it');
      assert.ok(!accepts(input, {value: 1}), 'no branch accepts it');
    });

    it('rejects a required property that is undefined, even when its schema accepts any value', () => {
      const catalog = load({
        catalogId: 'any-required',
        components: {
          Holder: {
            type: 'object',
            properties: {component: {const: 'Holder'}, payload: {description: 'Anything.'}},
            required: ['component', 'payload'],
          },
        },
        functions: {
          required: {
            properties: {
              call: {const: 'required'},
              args: {type: 'object', properties: {value: {}}, required: ['value']},
            },
          },
        },
      });
      const holder = catalog.components.get('Holder')!.schema;
      assert.ok(accepts(holder, {payload: 0}));
      assert.ok(!accepts(holder, {}));
      assert.ok(!accepts(holder, {payload: undefined}));
      const args = catalog.functions.get('required')!.schema;
      assert.ok(accepts(args, {value: null}));
      assert.ok(!accepts(args, {}));
      assert.ok(!accepts(args, {value: undefined}));
    });

    it('fills the defaults of function arguments', () => {
      const catalog = load({
        catalogId: 'defaults',
        protocolVersion: '1.0',
        functions: {
          quote: {
            type: 'object',
            properties: {
              '@call': {const: 'quote'},
              'args': {
                type: 'object',
                properties: {
                  symbol: {type: 'string'},
                  currency: {type: 'string', default: 'USD'},
                  options: {
                    type: 'object',
                    properties: {extendedHours: {type: 'boolean', default: false}},
                    additionalProperties: false,
                  },
                  legs: {
                    type: 'array',
                    items: {type: 'object', properties: {side: {type: 'string', default: 'buy'}}},
                  },
                },
                required: ['symbol'],
                additionalProperties: false,
              },
            },
            required: ['@call', 'args'],
          },
        },
      });
      const quote = catalog.functions.get('quote')!.schema;
      assert.deepStrictEqual(validate(quote, {symbol: 'GOOG'}), {
        value: {symbol: 'GOOG', currency: 'USD'},
      });
      assert.deepStrictEqual(
        validate(quote, {symbol: 'GOOG', currency: 'EUR', options: {}, legs: [{}]}),
        {
          value: {
            symbol: 'GOOG',
            currency: 'EUR',
            options: {extendedHours: false},
            legs: [{side: 'buy'}],
          },
        },
      );
      assert.ok(!accepts(quote, {currency: 'EUR'}));
    });

    it('reads function arguments from a list, a shorthand map, $ref and allOf', () => {
      const catalog = load({
        catalogId: 'args',
        protocolVersion: '1.0',
        $defs: {
          MyArgs: {
            type: 'object',
            properties: {valid_param: {type: 'string'}},
            required: ['valid_param'],
            additionalProperties: false,
          },
        },
        functions: {
          refFunc: {parameters: {$ref: '#/$defs/MyArgs'}, returnType: 'string'},
          shorthand: {parameters: {count: {type: 'number'}}, returnType: 'string'},
          allOfFunc: {
            parameters: {
              allOf: [
                {$ref: '#/$defs/MyArgs'},
                {properties: {extra_arg: {type: 'number'}}, required: ['extra_arg']},
              ],
            },
          },
        },
      });
      const refFunc = catalog.functions.get('refFunc')!.schema;
      assert.ok(accepts(refFunc, {valid_param: 'hello'}));
      assert.ok(!accepts(refFunc, {}));
      assert.ok(!accepts(refFunc, {valid_param: 'hello', unexpected: 1}));
      const shorthand = catalog.functions.get('shorthand')!.schema;
      assert.ok(accepts(shorthand, {count: 1}));
      assert.ok(!accepts(shorthand, {count: 'one'}));
      const allOfFunc = catalog.functions.get('allOfFunc')!.schema;
      assert.ok(!accepts(allOfFunc, {valid_param: 'hello'}));
      assert.ok(!accepts(allOfFunc, {extra_arg: 42}));

      const list = load({
        catalogId: 'list',
        functions: [{name: 'add', parameters: {a: {type: 'number'}, b: {type: 'number'}}}],
      });
      assert.ok(accepts(list.functions.get('add')!.schema, {a: 1, b: 2}));
      assert.ok(!accepts(list.functions.get('add')!.schema, {a: 'one'}));
    });

    it('leaves a v0.9 object open unless it closes itself', () => {
      const catalog = load({
        catalogId: 'open',
        components: {
          Open: {type: 'object', properties: {title: {type: 'string'}}},
          Typed: {
            type: 'object',
            properties: {title: {type: 'string'}},
            additionalProperties: {type: 'string'},
          },
          Closed: {
            type: 'object',
            properties: {title: {type: 'string'}},
            unevaluatedProperties: false,
          },
        },
      });
      const schema = (name: string) => catalog.components.get(name)!.schema;
      assert.ok(accepts(schema('Open'), {title: 'A', extra: 1}));
      assert.ok(accepts(schema('Typed'), {title: 'B', extra: 'text'}));
      assert.ok(!accepts(schema('Typed'), {title: 'B', extra: 1}));
      assert.ok(!accepts(schema('Closed'), {title: 'C', extra: 'rejected'}));
    });

    it('closes a v1.0 component the way the protocol envelope does', () => {
      const open = {type: 'object', properties: {title: {type: 'string'}}};
      const v10 = load({catalogId: 'v10', protocolVersion: '1.0', components: {Open: open}});
      assert.ok(accepts(v10.components.get('Open')!.schema, {title: 'A'}));
      assert.ok(!accepts(v10.components.get('Open')!.schema, {title: 'A', extra: 1}));
      const passthrough = {...open, additionalProperties: true};
      const v10Open = load({
        catalogId: 'v10',
        protocolVersion: '1.0',
        components: {Open: passthrough},
      });
      assert.ok(accepts(v10Open.components.get('Open')!.schema, {title: 'A', extra: 1}));
      // toJson keeps the definition as written.
      assert.deepStrictEqual((v10.toJson()['components'] as Record<string, unknown>)['Open'], open);
    });

    it("keeps a theme's id and component properties", () => {
      const catalog = load({
        catalogId: 'theme',
        components: {},
        theme: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            component: {type: 'string'},
            primaryColor: {type: 'string'},
          },
          required: ['id', 'component', 'primaryColor'],
        },
      });
      assert.ok(accepts(catalog.themeSchema, {id: 't', component: 'Dark', primaryColor: '#000'}));
      assert.ok(!accepts(catalog.themeSchema, {primaryColor: '#000'}));
    });

    it('reads a theme written as a bare map of properties', () => {
      const catalog = load(
        {catalogId: 'styles', components: {}, styles: {primaryColor: {type: 'string'}}},
        '0.8',
      );
      assert.ok(accepts(catalog.themeSchema, {primaryColor: '#000'}));
      assert.ok(!accepts(catalog.themeSchema, {primaryColor: 1}));
    });

    it('resolves a local definition the catalog lacks against the common types', () => {
      const catalog = load({
        catalogId: 'fallback',
        components: {
          Box: {type: 'object', properties: {children: {$ref: '#/$defs/ChildList'}}},
        },
      });
      const box = catalog.components.get('Box')!.schema;
      assert.ok(accepts(box, {children: ['a', 'b']}));
      assert.ok(!accepts(box, {children: 7}));
      assert.deepStrictEqual([...catalog.componentRefMap['Box'].listRefs], ['children']);
    });

    it('reads the child references a v1.0 catalog takes from the common types', () => {
      const catalog = load(readJson('catalogs/basic/v1/catalog.json'));
      const refs = catalog.componentRefMap;
      assert.ok(refs['Card'].singleRefs.has('child'));
      assert.ok(refs['Button'].singleRefs.has('child'));
      assert.ok(refs['Modal'].singleRefs.has('trigger'));
      assert.ok(refs['Modal'].singleRefs.has('content'));
      assert.ok(refs['Row'].listRefs.has('children'));
    });

    it('keeps nested child references from inline object array items', () => {
      const catalog = load({
        catalogId: 'tabs-cat',
        protocolVersion: '0.9',
        components: {
          Tabs: {
            type: 'object',
            properties: {
              tabs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {title: {type: 'string'}, child: {$ref: '#/$defs/ComponentId'}},
                },
              },
            },
          },
        },
      });
      const refs = catalog.componentRefMap['Tabs'];
      assert.deepStrictEqual([...refs.listRefs], ['tabs']);
      assert.deepStrictEqual([...(refs.nestedRefs?.['tabs'] ?? [])], ['child']);
      const tabs = catalog.components.get('Tabs')!.schema;
      assert.ok(accepts(tabs, {tabs: [{title: 'Overview', child: 'c1', extra: 1}]}));
      assert.ok(!accepts(tabs, {tabs: [{title: 42}]}));
    });

    it('declares only what the catalog and the common types declare', () => {
      const catalog = load(
        {
          catalogId: 'custom',
          components: {
            CustomButton: {
              type: 'object',
              allOf: [
                {
                  $ref: 'https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon',
                },
                {properties: {label: {type: 'string'}}, required: ['label']},
              ],
            },
          },
        },
        '0.9',
      );
      const keys = declaredKeys(catalog, 'CustomButton');
      assert.ok(keys.includes('accessibility') && keys.includes('label'));
      assert.ok(!keys.includes('weight'));
      assert.ok(accepts(catalog.components.get('CustomButton')!.schema, {label: 'Go'}));
    });

    it('resolves the common types under their absolute URI, and the catalog beside them', () => {
      const catalog = load(readJson('specification/v0_9_1/catalogs/basic/catalog.json'), '0.9');
      const text = catalog.components.get('Text')!.schema;
      // DynamicString -> FunctionCall -> catalog.json#/$defs/anyFunction, from the
      // common types the catalog names as https://a2ui.org/specification/v0_9/common_types.json.
      assert.ok(accepts(text, {text: {call: 'formatString', args: {value: 'x'}}}));
      assert.ok(!accepts(text, {text: {call: 'formatString', args: {value: 'x'}, bogus: 1}}));
    });

    it('validates a function call in a property apart from the functions of the catalog', () => {
      const catalog = load(readJson('catalogs/basic/v1/catalog.json'));
      const text = catalog.components.get('Text')!.schema;
      // A call to a function this catalog lacks, as a call to another catalog is.
      assert.ok(accepts(text, {text: {'@call': 'elsewhere', 'args': {}, 'catalogId': 'other'}}));
      assert.ok(!accepts(text, {text: {'@call': 'formatString', 'args': {}, 'bogus': 1}}));
    });

    it('fails to load, naming the entry, when a schema references a document it is not given', () => {
      assert.throws(
        () =>
          load({
            catalogId: 'unknown_external_ref',
            components: {
              Widget: {
                type: 'object',
                allOf: [{$ref: 'other_document.json#/$defs/NotAProtocolType'}],
              },
            },
          }),
        (err: unknown) =>
          err instanceof A2uiConfigurationError &&
          err.message.startsWith(
            "Component 'Widget' of catalog 'unknown_external_ref': its JSON Schema could not be compiled",
          ),
      );
      assert.throws(
        () =>
          load({
            catalogId: 'bad_args',
            functions: {f: {parameters: {$ref: '#/$defs/MissingArgs'}}},
          }),
        (err: unknown) =>
          err instanceof A2uiConfigurationError &&
          err.message.startsWith("Function 'f' of catalog 'bad_args'"),
      );
    });

    it('resolves references without network or disk I/O', t => {
      const originalFetch = globalThis.fetch;
      t.mock.method(fsPromises, 'readFile', () => {
        throw new Error('Unexpected fs.promises.readFile during schema resolution');
      });
      globalThis.fetch = (() => {
        throw new Error('Unexpected globalThis.fetch during schema resolution');
      }) as typeof fetch;
      try {
        const catalog = load({
          catalogId: 'network_free',
          protocolVersion: '1.0',
          $defs: {Tone: {type: 'string', enum: ['info', 'warning']}},
          components: {
            FormField: {
              type: 'object',
              allOf: [{$ref: 'common_types.json#/$defs/Checkable'}],
              properties: {
                component: {const: 'FormField'},
                label: {$ref: 'common_types.json#/$defs/DynamicString'},
                count: {
                  $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicNumber',
                },
                child: {$ref: 'common_types.json#/$defs/Child'},
                tone: {$ref: '#/$defs/Tone'},
              },
              required: ['component', 'label'],
            },
          },
        });
        const validator = new PayloadValidator(catalog, STRICT_VALIDATION);
        validator.validateComponent({
          'id': 'field_1',
          'component': 'FormField',
          'label': {'@path': '/form/label'},
          'count': 5,
          'child': 'child_1',
          'tone': 'info',
          '@checks': [{condition: {'@path': '/valid'}, message: 'Valid'}],
        });
        assert.throws(
          () => validator.validateComponent({id: 'bad', component: 'FormField', label: 12345}),
          A2uiValidationError,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('component envelope fields', () => {
    it('leaves id, component and @catalogId to the envelope', () => {
      const catalog = load({
        catalogId: 'envelope',
        protocolVersion: '1.0',
        components: {
          Toggle: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/ComponentCommon'},
              {
                properties: {component: {const: 'Toggle'}, on: {type: 'boolean'}},
                required: ['component', 'on'],
              },
            ],
            unevaluatedProperties: false,
          },
        },
      });
      const toggle = catalog.components.get('Toggle')!.schema;
      assert.ok(accepts(toggle, {on: true}), 'no id or component');
      assert.ok(accepts(toggle, {'on': true, '@metadata': {extensions: {}}}));
      const keys = declaredKeys(catalog, 'Toggle');
      assert.ok(!keys.includes('component'));
      assert.ok(!keys.includes('@catalogId'));
      assert.ok(keys.includes('@accessibility') && keys.includes('@metadata'));
      // `id` (a ComponentId) is not a child reference.
      const refs = catalog.componentRefMap['Toggle'];
      assert.deepStrictEqual([...refs.singleRefs, ...refs.listRefs], []);
      new PayloadValidator(catalog, STRICT_VALIDATION).validateComponent({
        'id': 'toggle1',
        'component': 'Toggle',
        '@catalogId': 'envelope',
        'on': false,
      });
    });

    it('treats a legacy bare catalogId as the envelope field', () => {
      const catalog = load({
        catalogId: 'https://example.com/legacy.json',
        protocolVersion: '1.0',
        components: {
          Toggle: {
            allOf: [
              {$ref: 'common_types.json#/$defs/ComponentCommon'},
              {properties: {component: {const: 'Toggle'}, size: {type: 'integer'}}},
            ],
          },
        },
      });
      const keys = declaredKeys(catalog, 'Toggle');
      assert.ok(!keys.includes('catalogId') && !keys.includes('@catalogId'));
      new PayloadValidator(catalog, STRICT_VALIDATION).validateComponent({
        id: 'toggle1',
        component: 'Toggle',
        catalogId: 'https://example.com/legacy.json',
        metadata: {extensions: {source: 'test'}},
        size: 2,
      });
    });

    it('keeps a custom checks property beside the Checkable @checks', () => {
      const catalog = load({
        catalogId: 'custom_checks',
        protocolVersion: '1.0',
        components: {
          ScoreInput: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/Checkable'},
              {
                type: 'object',
                properties: {component: {const: 'ScoreInput'}, checks: {type: 'integer'}},
                required: ['component', 'checks'],
              },
            ],
          },
        },
      });
      new PayloadValidator(catalog, STRICT_VALIDATION).validateComponent({
        'id': 'score_1',
        'component': 'ScoreInput',
        'checks': 3,
        '@checks': [{condition: {'@path': '/ok'}, message: 'Must pass'}],
      });
    });

    it('validates a v0.9 component against the v0.9 common types, which have no @ mixins', () => {
      const catalog = load(
        {
          catalogId: 'v09_checkable',
          components: {
            Field: {
              type: 'object',
              allOf: [
                {$ref: 'common_types.json#/$defs/ComponentCommon'},
                {$ref: 'common_types.json#/$defs/Checkable'},
                {
                  type: 'object',
                  properties: {component: {const: 'Field'}, label: {type: 'string'}},
                  required: ['component', 'label'],
                },
              ],
              unevaluatedProperties: false,
            },
          },
        },
        '0.9',
      );
      const keys = declaredKeys(catalog, 'Field');
      assert.ok(keys.includes('accessibility') && keys.includes('checks'));
      assert.ok(!keys.includes('@accessibility') && !keys.includes('@checks'));
      assert.throws(
        () =>
          new PayloadValidator(catalog, STRICT_VALIDATION).validateComponent({
            'id': 'f1',
            'component': 'Field',
            'label': 'Name',
            '@checks': [{condition: true, message: 'No v1.0 @checks on v0.9'}],
          }),
        A2uiValidationError,
      );
    });
  });

  describe('document checks', () => {
    it('reads allowedParents and allowedChildren, keeping only strings', () => {
      const catalog = load({
        catalogId: 'hierarchy',
        components: {
          StrictNode: {
            properties: {label: {type: 'string'}},
            allowedParents: ['ParentValid', 123, null],
            allowedChildren: ['ChildValid', false, {}],
          },
        },
      });
      const node = catalog.components.get('StrictNode')!;
      assert.deepStrictEqual(node.allowedParents, ['ParentValid']);
      assert.deepStrictEqual(node.allowedChildren, ['ChildValid']);
    });

    it('checks the UAX #31 identifiers of a v1.0 catalog', () => {
      const v10 = (document: Record<string, unknown>) => () =>
        load({catalogId: 'ids', protocolVersion: '1.0', ...document});
      assert.throws(v10({components: {'bad-name': {type: 'object'}}}), /UAX #?31/);
      assert.throws(
        v10({components: {Good: {properties: {'bad-prop': {type: 'string'}}}}}),
        /UAX #?31/,
      );
      assert.throws(v10({functions: {f: {parameters: {'invalid-param': {}}}}}), /UAX #?31/);
      assert.throws(
        v10({functions: {f: {parameters: {allOf: [{properties: {'123bad': {}}}]}}}}),
        /UAX #?31/,
      );
      assert.throws(
        v10({
          $defs: {BadDefs: {type: 'object', properties: {'123bad': {type: 'string'}}}},
          functions: {f: {parameters: {$ref: '#/$defs/BadDefs'}}},
        }),
        /UAX #?31/,
      );
      assert.ok(v10({functions: {f: {parameters: {valid_param: {}}}}})().functions.has('f'));
      // Below v1.0 identifiers are not checked.
      assert.ok(load({catalogId: 'ids', components: {'bad-name': {}}}).components.has('bad-name'));
    });

    describe('v1.0 external $ref targets', () => {
      const rejects = (catalog: Record<string, unknown>, ref: string, pointer: string) =>
        assert.throws(
          () => load({catalogId: 'test_external_ref', protocolVersion: '1.0', ...catalog}),
          (err: unknown) =>
            err instanceof A2uiCatalogError &&
            err.message ===
              `Unsupported external $ref '${ref}' at ${pointer}: a v1.0 catalog may only ` +
                'reference its own components and functions (#/...) or common_types.json.',
        );

      it('rejects a relative reference to a component of another catalog', () => {
        rejects(
          {
            components: {
              FancyText: {
                type: 'object',
                allOf: [{$ref: 'basic_catalog.json#/components/Text'}],
                properties: {component: {const: 'FancyText'}},
                required: ['component'],
              },
            },
          },
          'basic_catalog.json#/components/Text',
          '/components/FancyText/allOf/0/$ref',
        );
      });

      it('rejects an absolute URI reference to another catalog', () => {
        const ref =
          'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json#/components/Button';
        rejects(
          {
            components: {
              FancyButton: {
                type: 'object',
                properties: {component: {const: 'FancyButton'}, action: {$ref: ref}},
              },
            },
          },
          ref,
          '/components/FancyButton/properties/action/$ref',
        );
      });

      it('rejects a catalog.json reference that is not the bare envelope placeholder', () => {
        rejects(
          {
            components: {
              Widget: {
                type: 'object',
                properties: {component: {const: 'Widget'}, child: {$ref: 'foo/catalog.json#/x'}},
              },
            },
          },
          'foo/catalog.json#/x',
          '/components/Widget/properties/child/$ref',
        );
      });

      it('rejects an external reference nested in function arguments', () => {
        rejects(
          {
            functions: {
              formatBadge: {
                type: 'object',
                returnType: 'string',
                properties: {
                  '@call': {const: 'formatBadge'},
                  'args': {
                    type: 'object',
                    properties: {value: {$ref: 'other_catalog.json#/functions/formatString'}},
                  },
                },
              },
            },
          },
          'other_catalog.json#/functions/formatString',
          '/functions/formatBadge/properties/args/properties/value/$ref',
        );
      });

      it('rejects an external reference in $defs and escapes the pointer', () => {
        rejects(
          {$defs: {'a/b~c': {anyOf: [{$ref: 'other_catalog.json#/$defs/Thing'}]}}},
          'other_catalog.json#/$defs/Thing',
          '/$defs/a~1b~0c/anyOf/0/$ref',
        );
      });

      it('accepts and resolves local, catalog.json and common_types.json references', () => {
        const catalog = load({
          catalogId: 'test_allowed_refs',
          protocolVersion: '1.0',
          components: {
            Label: {
              type: 'object',
              allOf: [{$ref: 'common_types.json#/$defs/Checkable'}],
              properties: {
                component: {const: 'Label'},
                text: {$ref: 'common_types.json#/$defs/DynamicString'},
                caption: {
                  $ref: 'https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString',
                },
                child: {$ref: 'catalog.json#/$defs/anyComponent'},
              },
            },
            Wrapper: {
              type: 'object',
              allOf: [{$ref: '#/components/Label'}],
              properties: {component: {const: 'Wrapper'}},
            },
          },
        });
        assert.deepStrictEqual([...catalog.components.keys()], ['Label', 'Wrapper']);
        const wrapper = catalog.components.get('Wrapper')!.schema;
        assert.ok(accepts(wrapper, {text: 'hi', caption: {'@path': '/c'}}));
        assert.ok(!accepts(wrapper, {text: 1}));
      });

      it('does not apply to a v0.9 catalog, which fails only because the document is not given', () => {
        assert.throws(
          () =>
            load(
              {
                catalogId: 'test_v09_external_ref',
                components: {
                  FancyText: {
                    type: 'object',
                    allOf: [{$ref: 'basic_catalog.json#/components/Text'}],
                  },
                },
              },
              '0.9',
            ),
          (err: unknown) =>
            err instanceof A2uiConfigurationError &&
            !(err instanceof A2uiCatalogError) &&
            err.message.includes('could not be compiled'),
        );
      });
    });
  });
});
