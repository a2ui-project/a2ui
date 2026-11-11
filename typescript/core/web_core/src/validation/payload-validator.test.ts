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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {z} from 'zod';
import {Catalog} from '../catalog/types.js';
import {A2uiValidationError} from '../errors.js';
import {MessageProcessor} from '../processing/message-processor.js';
import {basicCatalog as v1BasicCatalog} from '../catalogs/basic/v1/catalog.js';
import {STRICT_VALIDATION} from './integrity-checker.js';
import {nestedCallRunsInCatalog, PayloadValidator} from './payload-validator.js';

describe('nestedCallRunsInCatalog', () => {
  const CATALOG = 'https://example.com/a';
  const OTHER = 'https://example.com/b';

  it('runs a catalogless call in the catalog only when it is the surface default', () => {
    assert.strictEqual(nestedCallRunsInCatalog(undefined, CATALOG, {catalogIsDefault: true}), true);
    assert.strictEqual(
      nestedCallRunsInCatalog(undefined, CATALOG, {catalogIsDefault: false}),
      false,
    );
  });

  it('runs a call naming a catalog only in that catalog', () => {
    for (const catalogIsDefault of [true, false]) {
      assert.strictEqual(nestedCallRunsInCatalog(CATALOG, CATALOG, {catalogIsDefault}), true);
      assert.strictEqual(nestedCallRunsInCatalog(OTHER, CATALOG, {catalogIsDefault}), false);
      assert.strictEqual(nestedCallRunsInCatalog('', CATALOG, {catalogIsDefault}), false);
    }
  });
});

describe('PayloadValidator', () => {
  it('throws A2uiValidationError when validateFunction args exceed MAX_FUNCTION_CALL_ARGS (1000)', () => {
    const cat = new Catalog(
      'https://example.com/v10',
      '1.0',
      [],
      [{name: 'upper', returnType: 'string', schema: z.object({}).passthrough()}],
    );
    const validator = new PayloadValidator(cat, STRICT_VALIDATION);
    const exactLimitArgs = Object.fromEntries(
      Array.from({length: 1000}, (_, i) => [`arg_${i}`, 'val']),
    );
    const oversizedArgs = Object.fromEntries(
      Array.from({length: 1001}, (_, i) => [`arg_${i}`, 'val']),
    );

    assert.doesNotThrow(() => validator.validateFunction('upper', exactLimitArgs));
    assert.throws(
      () => validator.validateFunction('upper', oversizedArgs),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes('exceeds maximum allowed arguments count (1000)'),
    );
  });

  it('validates function arguments when parameters schema uses $ref', () => {
    const catalog = Catalog.fromJson({
      catalogId: 'https://example.com/test-ref-validator.json',
      protocolVersion: '1.0',
      $defs: {
        RefArgs: {
          type: 'object',
          properties: {
            field: {type: 'string'},
          },
          required: ['field'],
        },
      },
      functions: {
        testRef: {
          parameters: {$ref: '#/$defs/RefArgs'},
          returnType: 'string',
        },
      },
    });

    const validator = new PayloadValidator(catalog, STRICT_VALIDATION);

    // Valid arguments pass
    assert.doesNotThrow(() => validator.validateFunction('testRef', {field: 'hello'}));

    // Missing required field throws
    assert.throws(
      () => validator.validateFunction('testRef', {}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes("Validation failed for function 'testRef'"),
    );

    // Unrecognized extra field throws in strict mode
    assert.throws(
      () => validator.validateFunction('testRef', {field: 'hello', unexpected: 123}),
      (err: unknown) =>
        err instanceof A2uiValidationError &&
        err.message.includes("Validation failed for function 'testRef'"),
    );
  });

  describe('v1.0 nested function calls', () => {
    const CATALOG_ID = 'https://example.com/v10';
    // `value` is a string or a nested call, like a DynamicString argument.
    const cat = new Catalog(
      CATALOG_ID,
      '1.0',
      [{name: 'Text', schema: z.object({text: z.any()})}],
      [
        {
          name: 'upper',
          returnType: 'string',
          schema: z.object({value: z.union([z.string(), z.object({}).passthrough()])}).strict(),
        },
      ],
    );

    function textWith(text: unknown): Record<string, unknown> {
      return {id: 't1', component: 'Text', text};
    }

    const unknownCall = textWith({'@call': 'notAFunction', args: {}});
    const badArgs = textWith({'@call': 'upper', args: {value: 3}});
    const unknownInArgs = textWith({
      '@call': 'upper',
      args: {value: {'@call': 'notAFunction', args: {}}},
    });
    const unknownInIndexArgs = textWith({
      '@call': '@index',
      args: {offset: {'@call': 'notAFunction', args: {}}},
    });
    const unknownInOwnCatalog = textWith({
      '@call': 'notAFunction',
      catalogId: CATALOG_ID,
      args: {},
    });
    const otherCatalogCall = textWith({
      '@call': 'notAFunction',
      catalogId: 'https://example.com/other',
      args: {value: 3},
    });

    /** Asserts that `fn` throws an `A2uiValidationError` whose message matches `pattern`. */
    function assertValidationError(fn: () => unknown, pattern: RegExp): void {
      assert.throws(
        fn,
        (err: unknown) => err instanceof A2uiValidationError && pattern.test(err.message),
      );
    }

    const UNKNOWN_FN = /Unrecognized function 'notAFunction'/;

    it('validates calls naming this catalog, or none in a component naming none', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);

      assert.doesNotThrow(() =>
        validator.validateComponent(textWith({'@call': 'upper', args: {value: 'x'}})),
      );
      assertValidationError(() => validator.validateComponent(unknownCall), UNKNOWN_FN);
      assertValidationError(
        () => validator.validateComponent(badArgs),
        /Validation failed for function 'upper'/,
      );
      assertValidationError(() => validator.validateComponent(unknownInArgs), UNKNOWN_FN);
      assertValidationError(() => validator.validateComponent(unknownInIndexArgs), UNKNOWN_FN);
      assertValidationError(() => validator.validateComponent(unknownInOwnCatalog), UNKNOWN_FN);
    });

    it('checks only identifiers of a call naming another catalog', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);

      assert.doesNotThrow(() => validator.validateComponent(otherCatalogCall));
      assertValidationError(
        () =>
          validator.validateComponent(
            textWith({'@call': 'not-a-function', catalogId: 'https://example.com/other'}),
          ),
        /Function name 'not-a-function' must be a valid UAX #31 identifier/,
      );
    });

    it('treats an empty catalogId as naming another catalog', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);

      assert.doesNotThrow(() =>
        validator.validateComponent(textWith({'@call': 'notAFunction', catalogId: '', args: {}})),
      );
      assertValidationError(
        () => validator.validateComponent(textWith({'@call': 'not-a-function', catalogId: ''})),
        /Function name 'not-a-function' must be a valid UAX #31 identifier/,
      );
    });

    it('rejects a catalogId on a system function call', () => {
      const validator = new PayloadValidator(cat);
      const indexWithCatalog = textWith({'@call': '@index', catalogId: CATALOG_ID});
      for (const comp of [indexWithCatalog, {...indexWithCatalog, catalogId: CATALOG_ID}]) {
        assertValidationError(
          () => validator.validateComponent(comp),
          /System function '@index' belongs to no catalog and must not name a catalogId/,
        );
      }
    });

    it('checks the calls of a component type the catalog does not define', () => {
      const validator = new PayloadValidator(cat, {
        ...STRICT_VALIDATION,
        allowUnknownElements: true,
      });
      const widgetWith = (call: unknown) => ({id: 'w1', component: 'Widget', prop: call});

      assert.doesNotThrow(() =>
        validator.validateComponent(widgetWith({'@call': 'upper', args: {value: 'x'}})),
      );
      assertValidationError(
        () => validator.validateComponent(widgetWith({'@call': 'upper', args: {value: 3}})),
        /Validation failed for function 'upper'/,
      );
      assertValidationError(
        () => validator.validateComponent(widgetWith({'@call': '@index', catalogId: CATALOG_ID})),
        /System function '@index' belongs to no catalog and must not name a catalogId/,
      );
      assertValidationError(
        () => validator.validateComponent(widgetWith({'@call': 'upper', args: {'bad-arg': 'x'}})),
        /Function argument 'bad-arg' in function 'upper' must be a valid UAX #31 identifier/,
      );
    });

    it('rejects non-object args whatever catalog the call runs in', () => {
      const validator = new PayloadValidator(cat);
      for (const call of [
        {'@call': 'upper', args: 123},
        {'@call': 'upper', catalogId: 'https://example.com/other', args: 123},
        {'@call': 'upper', catalogId: 'https://example.com/other', args: ['x']},
        {'@call': '@index', args: 123},
      ]) {
        assertValidationError(
          () => validator.validateComponent(textWith(call)),
          /Expected object, received (number|array)/,
        );
      }
    });

    it('rejects a non-string catalogId on a call', () => {
      const validator = new PayloadValidator(cat);
      for (const catalogId of [7, null, {}]) {
        assertValidationError(
          () => validator.validateComponent(textWith({'@call': 'upper', catalogId, args: {}})),
          /Function call 'upper' has a non-string 'catalogId'/,
        );
      }
    });

    it('rejects an empty function name instead of skipping the call', () => {
      const validator = new PayloadValidator(cat);
      const emptyName = /Function name '' must be a valid UAX #31 identifier/;
      for (const call of [
        {'@call': ''},
        {'@call': '', catalogId: 'https://example.com/other'},
        {'@call': 'upper', args: {value: {'@call': ''}}},
      ]) {
        assertValidationError(() => validator.validateComponent(textWith(call)), emptyName);
      }
    });

    it('skips a call with an empty name below v1.0', () => {
      const v09 = new Catalog('https://example.com/v09', '0.9', [
        {name: 'Text', schema: z.object({text: z.any()})},
      ]);
      const validator = new PayloadValidator(v09, STRICT_VALIDATION);
      assert.doesNotThrow(() => validator.validateComponent(textWith({call: '', args: {}})));
    });

    it('leaves catalogId and metadata out of a closed component schema', () => {
      const closed = new Catalog(CATALOG_ID, '1.0', [
        {name: 'Tag', schema: z.object({label: z.string()}).strict()},
      ]);
      const validator = new PayloadValidator(closed, STRICT_VALIDATION);
      for (const prefix of ['', '@']) {
        assert.doesNotThrow(() =>
          validator.validateComponent({
            'id': 'root',
            'component': 'Tag',
            [`${prefix}catalogId`]: CATALOG_ID,
            [`${prefix}metadata`]: {extensions: {note: 'x'}},
            'label': 'Hello',
          }),
        );
        // The metadata envelope holds only extensions (#3466).
        assert.throws(
          () =>
            validator.validateComponent({
              'id': 'root',
              'component': 'Tag',
              [`${prefix}metadata`]: {note: 'x'},
              'label': 'Hello',
            }),
          A2uiValidationError,
        );
      }
    });

    it('walks nested objects whose keys are named id or component', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);

      for (const key of ['id', 'component']) {
        assertValidationError(
          () => validator.validateComponent(textWith({[key]: {'@call': 'notAFunction', args: {}}})),
          UNKNOWN_FN,
        );
      }
    });

    it('tolerates unknown functions and components but checks arguments without a config', () => {
      const validator = new PayloadValidator(cat);

      assert.doesNotThrow(() => validator.validateComponent(unknownCall));
      assert.doesNotThrow(() => validator.validateComponent({id: 'w', component: 'NoSuchWidget'}));
      assertValidationError(
        () => validator.validateComponent(badArgs),
        /Validation failed for function 'upper'/,
      );
      assertValidationError(
        () => validator.validateComponent(textWith({'@call': '@index', args: {offset: 'x'}})),
        /Validation failed for function '@index'/,
      );
    });

    it('checks only identifiers of catalogless calls in a component naming a catalog', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);
      // Such calls run in the surface default, which need not be this catalog.
      for (const componentCatalogId of [CATALOG_ID, '']) {
        const inCatalog = (comp: Record<string, unknown>) => ({
          ...comp,
          catalogId: componentCatalogId,
        });

        for (const comp of [unknownCall, badArgs, unknownInArgs, unknownInIndexArgs]) {
          assert.doesNotThrow(() => validator.validateComponent(inCatalog(comp)));
        }
        assertValidationError(
          () =>
            validator.validateComponent(
              inCatalog(textWith({'@call': 'upper', args: {'bad-arg': 'x'}})),
            ),
          /Function argument 'bad-arg' in function 'upper' must be a valid UAX #31 identifier/,
        );
        // Reserved system functions are still validated fully.
        assertValidationError(
          () =>
            validator.validateComponent(
              inCatalog(textWith({'@call': '@index', args: {offset: 'x'}})),
            ),
          /Validation failed for function '@index'/,
        );
        // A call naming another catalog is still checked for identifiers only.
        assert.doesNotThrow(() => validator.validateComponent(inCatalog(otherCatalogCall)));
      }

      // A call naming this catalog runs here, so it is checked fully.
      assertValidationError(
        () => validator.validateComponent({...unknownInOwnCatalog, catalogId: CATALOG_ID}),
        UNKNOWN_FN,
      );
      assertValidationError(
        () =>
          validator.validateComponent(
            textWith({'@call': 'upper', catalogId: CATALOG_ID, args: {value: 3}}),
          ),
        /Validation failed for function 'upper'/,
      );
    });
  });

  describe('v0.9 nested function calls', () => {
    const cat = new Catalog(
      'https://example.com/v09',
      '0.9',
      [{name: 'Text', schema: z.object({text: z.any()})}],
      [{name: 'upper', returnType: 'string', schema: z.object({value: z.string()}).strict()}],
    );

    it('validates every call against this catalog, whatever catalogId the component names', () => {
      const validator = new PayloadValidator(cat, STRICT_VALIDATION);
      for (const componentCatalogId of [
        undefined,
        'https://example.com/v09',
        'https://example.com/other',
      ]) {
        const textWith = (text: unknown): Record<string, unknown> => ({
          id: 't1',
          component: 'Text',
          text,
          ...(componentCatalogId === undefined ? {} : {catalogId: componentCatalogId}),
        });

        assert.doesNotThrow(() =>
          validator.validateComponent(textWith({call: 'upper', args: {value: 'x'}})),
        );
        assert.throws(
          () => validator.validateComponent(textWith({call: 'notAFunction', args: {}})),
          /Unrecognized function 'notAFunction'/,
        );
        assert.throws(
          () => validator.validateComponent(textWith({call: 'upper', args: {value: 3}})),
          /Validation failed for function 'upper'/,
        );
        // A v0.9 call cannot select a catalog; it runs in the surface catalog.
        assert.throws(
          () =>
            validator.validateComponent(
              textWith({call: 'notAFunction', catalogId: 'https://example.com/other', args: {}}),
            ),
          /Unrecognized function 'notAFunction'/,
        );
      }
    });
  });

  describe('component envelope mixins', () => {
    /** A v0.9 or v1.0 catalog with a `GcbpTable` declaring its own `metadata` and `catalogId`. */
    function gcbpCatalog(protocolVersion: string) {
      return Catalog.fromJson({
        catalogId: 'https://example.com/gcbp.json',
        protocolVersion,
        components: {
          GcbpTable: {
            type: 'object',
            properties: {
              metadata: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {pageNumber: {type: 'number'}, pageSize: {type: 'number'}},
                    additionalProperties: false,
                  },
                  {$ref: 'common_types.json#/$defs/DataBinding'},
                ],
              },
              catalogId: {type: 'string'},
              accessibility: {type: 'string'},
              checks: {type: 'array', items: {type: 'string'}},
            },
            additionalProperties: false,
          },
          Plain: {
            type: 'object',
            properties: {label: {type: 'string'}},
            additionalProperties: false,
          },
          Checked: {
            type: 'object',
            allOf: [
              {$ref: 'common_types.json#/$defs/Checkable'},
              {type: 'object', properties: {label: {type: 'string'}}},
            ],
            unevaluatedProperties: false,
          },
        },
      });
    }

    describe('below v1.0', () => {
      const validator = new PayloadValidator(gcbpCatalog('0.9'), STRICT_VALIDATION);

      it('checks custom metadata and catalogId properties against the component schema', () => {
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'root',
            component: 'GcbpTable',
            metadata: {pageNumber: 0, pageSize: 10},
            catalogId: 'source-catalog',
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'root',
            component: 'GcbpTable',
            metadata: {path: '/table/metadata'},
          }),
        );
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'GcbpTable',
              metadata: {extensions: {com_example: 1}},
            }),
          A2uiValidationError,
        );
      });

      it('rejects @-prefixed envelope keys as unknown properties', () => {
        for (const key of ['@metadata', '@catalogId', '@accessibility', '@checks']) {
          assert.throws(
            () => validator.validateComponent({id: 'root', component: 'Plain', [key]: {}}),
            A2uiValidationError,
            key,
          );
        }
      });

      it('rejects a metadata property the component does not declare', () => {
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'Plain',
              metadata: {extensions: {com_example: 1}},
            }),
          A2uiValidationError,
        );
      });
    });

    describe('from v1.0', () => {
      const validator = new PayloadValidator(gcbpCatalog('1.0'), STRICT_VALIDATION);

      it('accepts @-prefixed mixins and legacy bare mixins', () => {
        assert.doesNotThrow(() =>
          validator.validateComponent({
            'id': 'root',
            'component': 'Checked',
            '@metadata': {extensions: {com_example_trace: 't1'}},
            '@accessibility': {label: 'Name'},
            '@checks': [{condition: true, message: 'Required'}],
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'root',
            component: 'Checked',
            metadata: {extensions: {com_example_trace: 't1'}},
            accessibility: {label: 'Name'},
            checks: [{condition: true, message: 'Required'}],
          }),
        );
      });

      it('validates @metadata extension keys as UAX #31 identifiers (#3466)', () => {
        for (const key of ['@metadata', 'metadata']) {
          assert.throws(
            () =>
              validator.validateComponent({
                id: 'root',
                component: 'Plain',
                [key]: {extensions: {'com.example.bad': 1}},
              }),
            A2uiValidationError,
            key,
          );
        }
      });

      it('rejects both @foo and legacy foo when foo is not a custom property', () => {
        assert.throws(
          () =>
            validator.validateComponent({
              'id': 'root',
              'component': 'Plain',
              '@accessibility': {label: 'New'},
              'accessibility': {label: 'Old'},
            }),
          (err: unknown) => {
            assert.ok(err instanceof A2uiValidationError);
            assert.match(
              err.message,
              /cannot specify both '@accessibility' and legacy 'accessibility'/,
            );
            assert.match(err.details[0].path, /\/@accessibility$/);
            return true;
          },
        );
        assert.throws(
          () =>
            validator.validateComponent({
              'id': 'root',
              'component': 'Plain',
              '@metadata': {},
              'metadata': {},
            }),
          (err: unknown) => {
            assert.ok(err instanceof A2uiValidationError);
            assert.match(err.message, /cannot specify both '@metadata' and legacy 'metadata'/);
            assert.match(err.details[0].path, /\/@metadata$/);
            return true;
          },
        );
      });

      it('keeps custom properties beside the @-prefixed mixins', () => {
        assert.doesNotThrow(() =>
          validator.validateComponent({
            'id': 'root',
            'component': 'GcbpTable',
            'metadata': {pageNumber: 0},
            'catalogId': 'custom-value',
            'accessibility': 'compact',
            'checks': ['non_empty'],
            '@metadata': {extensions: {com_example_vendor: 'acme'}},
            '@accessibility': {label: 'Table'},
          }),
        );
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'GcbpTable',
              metadata: {extensions: {com_example_vendor: 'acme'}},
            }),
          A2uiValidationError,
        );
      });

      it('rejects check rules on a component that is not checkable', () => {
        assert.throws(
          () =>
            validator.validateComponent({
              'id': 'root',
              'component': 'Plain',
              '@checks': [{condition: true, message: 'x'}],
            }),
          /is not checkable/,
        );
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'Plain',
              checks: [{condition: true, message: 'x'}],
            }),
          A2uiValidationError,
        );
      });

      it('rejects a non-string @catalogId', () => {
        assert.throws(
          () => validator.validateComponent({'id': 'root', 'component': 'Plain', '@catalogId': 3}),
          /non-string '@catalogId'/,
        );
      });

      it('rejects @-prefixed mixin names nested inside a property', () => {
        const catalog = Catalog.fromJson({
          catalogId: 'https://example.com/nested.json',
          protocolVersion: '1.0',
          components: {
            Card: {
              type: 'object',
              properties: {details: {$ref: 'common_types.json#/$defs/DynamicValue'}},
            },
          },
        });
        const nested = new PayloadValidator(catalog, STRICT_VALIDATION);
        assert.throws(
          () =>
            nested.validateComponent({
              id: 'root',
              component: 'Card',
              details: {'@metadata': {extensions: {}}},
            }),
          (err: unknown) =>
            err instanceof A2uiValidationError && err.code === 'INVALID_RESERVED_KEY',
        );
        assert.doesNotThrow(() =>
          nested.validateComponent({id: 'root', component: 'Card', details: {'@@metadata': 'x'}}),
        );
      });
    });

    describe('v1.0 @child, @action, and @functionCall directives and dual-read', () => {
      it('accepts @child, @action, and @functionCall against basic catalog schemas and open components', () => {
        const validator = new PayloadValidator(v1BasicCatalog, STRICT_VALIDATION);

        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'root',
            component: 'Column',
            children: {'@child': ['card_1', 'tabs_1', 'btn_1', 'btn_2', 'list_1']},
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'card_1',
            component: 'Card',
            child: {'@child': 'txt_1'},
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'tabs_1',
            component: 'Tabs',
            tabs: [{title: 'Tab 1', child: {'@child': 'txt_1'}}],
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'list_1',
            component: 'List',
            children: {'@child': 'tpl_1', '@path': '/items'},
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'btn_1',
            component: 'Button',
            child: {'@child': 'txt_1'},
            action: {
              '@action': {
                name: 'submit',
                userMessage: 'Submitting',
                context: {ok: true, escaped: {'@@child': 'literal'}},
              },
            },
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'btn_2',
            component: 'Button',
            child: {'@child': 'txt_1'},
            action: {
              '@functionCall': {
                '@call': 'openUrl',
                args: {url: 'https://example.com'},
              },
            },
          }),
        );
      });

      it('rejects malformed @child, @action, @functionCall, and directives inside DynamicValue at slot pointers', () => {
        const catalog = Catalog.fromJson({
          catalogId: 'https://example.com/custom.json',
          protocolVersion: '1.0',
          components: {
            CustomCard: {
              type: 'object',
              properties: {
                details: {$ref: 'common_types.json#/$defs/DynamicValue'},
                action: {$ref: 'common_types.json#/$defs/Action'},
                slot: {$ref: 'common_types.json#/$defs/Child'},
                slots: {$ref: 'common_types.json#/$defs/ChildList'},
              },
            },
          },
          functions: [
            {
              name: 'doThing',
              returnType: 'string',
              parameters: {type: 'object', properties: {x: {type: 'string'}}},
            },
          ],
        });
        const strictValidator = new PayloadValidator(catalog, STRICT_VALIDATION);
        const openValidator = new PayloadValidator(catalog, {allowUnknownElements: true});

        // Invalid @child shapes
        for (const badChild of [
          {'@child': 123},
          {'@child': ''},
          {'@child': ['']},
          {'@child': ['a'], '@path': '/items'},
          {'@child': 'tpl', '@path': ''},
          {'@child': 'tpl', '@path': {'@path': '/items'}},
          {'@child': 'a', extra: 1},
        ]) {
          assert.throws(
            () =>
              strictValidator.validateComponent({
                id: 'root',
                component: 'CustomCard',
                slots: badChild,
              }),
            (err: unknown) => err instanceof A2uiValidationError && err.path === '/slots',
          );
          assert.throws(
            () =>
              openValidator.validateComponent({
                id: 'root',
                component: 'OpenShell',
                header: badChild,
              }),
            (err: unknown) => err instanceof A2uiValidationError && err.path === '/header',
          );
        }

        // Invalid @action shapes
        for (const badAction of [
          {'@action': {}},
          {'@action': {name: ''}},
          {'@action': {name: 'go', extra: 1}},
          {'@action': {name: 'go'}, extra: 1},
          {'@action': 'not-an-object'},
        ]) {
          assert.throws(
            () =>
              strictValidator.validateComponent({
                id: 'root',
                component: 'CustomCard',
                action: badAction,
              }),
            A2uiValidationError,
          );
        }

        // Invalid @functionCall shapes
        for (const badFn of [
          {'@functionCall': {notACall: 1}},
          {'@functionCall': {'@call': ''}},
          {'@functionCall': {'@call': 'doThing'}, extra: 1},
        ]) {
          assert.throws(
            () =>
              strictValidator.validateComponent({
                id: 'root',
                component: 'CustomCard',
                action: badFn,
              }),
            A2uiValidationError,
          );
        }

        // Directives inside DynamicValue / action context / CheckRule.condition fail with INVALID_RESERVED_KEY
        for (const badDyn of [
          {'@child': 'c1'},
          {'@action': {name: 'go'}},
          {'@functionCall': {'@call': 'doThing'}},
        ]) {
          assert.throws(
            () =>
              strictValidator.validateComponent({
                id: 'root',
                component: 'CustomCard',
                details: badDyn,
              }),
            (err: unknown) =>
              err instanceof A2uiValidationError &&
              err.code === 'INVALID_RESERVED_KEY' &&
              err.path === '/details',
          );
          assert.throws(
            () =>
              strictValidator.validateComponent({
                id: 'root',
                component: 'CustomCard',
                action: {'@action': {name: 'go', context: {nested: badDyn}}},
              }),
            (err: unknown) =>
              err instanceof A2uiValidationError && err.code === 'INVALID_RESERVED_KEY',
          );
          assert.throws(
            () =>
              v1BasicCatalog &&
              new PayloadValidator(v1BasicCatalog, STRICT_VALIDATION).validateComponent({
                'id': 'tf1',
                'component': 'TextField',
                'label': 'Name',
                'value': {'@path': '/name'},
                '@checks': [{condition: badDyn, message: 'Bad'}],
              }),
            (err: unknown) =>
              err instanceof A2uiValidationError && err.code === 'INVALID_RESERVED_KEY',
          );
        }
      });

      it('rejects @child, @action, and @functionCall on pre-1.0 (v0.9) catalogs', () => {
        const v09Catalog = Catalog.fromJson({
          catalogId: 'https://example.com/v09.json',
          protocolVersion: '0.9',
          components: {
            Card: {
              type: 'object',
              properties: {
                child: {type: 'string', description: 'REF:#/$defs/Child'},
                children: {type: 'array', items: {type: 'string'}},
              },
            },
          },
        });
        const validator = new PayloadValidator(v09Catalog, STRICT_VALIDATION);
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'Card',
              child: {'@child': 'c1'},
            }),
          A2uiValidationError,
        );
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'root',
              component: 'Card',
              children: {'@child': ['c1']},
            }),
          A2uiValidationError,
        );
      });

      it('reports clean UNALLOWED_CHILD slot pointers without trailing /@child across nested slots', () => {
        const cat = new Catalog('https://example.com/comp.json', '1.0', [
          {
            name: 'Shell',
            schema: z.object({}).passthrough(),
            allowedChildren: ['Text'],
          },
          {
            name: 'Text',
            schema: z.object({text: z.string()}),
          },
          {
            name: 'Badge',
            schema: z.object({label: z.string()}),
          },
        ]);
        const proc = new MessageProcessor([cat], undefined, {
          validationConfig: STRICT_VALIDATION,
        });
        proc.processMessages([
          {
            version: '1.0',
            createSurface: {surfaceId: 's1', catalogId: cat.id, sendDataModel: false},
          },
        ]);
        assert.throws(
          () =>
            proc.processMessages([
              {
                version: '1.0',
                updateComponents: {
                  surfaceId: 's1',
                  components: [
                    {
                      id: 'root',
                      component: 'Shell',
                      sections: [{body: {'@child': 'bad'}}],
                    },
                    {id: 'bad', component: 'Badge', label: 'No'},
                  ],
                },
              },
            ]),
          (err: unknown) =>
            err instanceof A2uiValidationError &&
            err.code === 'UNALLOWED_CHILD' &&
            err.path === '/components/0/sections/0/body',
        );
        // Also check template @child strips trailing /@child
        assert.throws(
          () =>
            proc.processMessages([
              {
                version: '1.0',
                updateComponents: {
                  surfaceId: 's1',
                  components: [
                    {
                      id: 'root',
                      component: 'Shell',
                      items: {'@child': 'bad', '@path': '/rows'},
                    },
                    {id: 'bad', component: 'Badge', label: 'No'},
                  ],
                },
              },
            ]),
          (err: unknown) =>
            err instanceof A2uiValidationError &&
            err.code === 'UNALLOWED_CHILD' &&
            err.path === '/components/0/items',
        );
      });

      it('rejects undeclared @child/@action/@functionCall pre-1.0 while allowing schema-declared ones', () => {
        const v09Catalog = new Catalog('https://example.com/v09-custom.json', '0.9', [
          {name: 'OpenBox', schema: z.object({}).passthrough()},
          {
            name: 'CustomAtTop',
            schema: z.object({'@child': z.string()}).strict(),
          },
          {
            name: 'CustomAtNested',
            schema: z
              .object({
                wrapper: z.object({'@action': z.string()}).passthrough(),
                list: z.array(z.object({'@functionCall': z.number()})),
              })
              .passthrough(),
          },
        ]);
        const strictV09 = new PayloadValidator(v09Catalog, STRICT_VALIDATION);
        const allowUnknownV09 = new PayloadValidator(v09Catalog, {
          ...STRICT_VALIDATION,
          allowUnknownElements: true,
        });

        // Open schema rejects undeclared directives at top-level and nested paths.
        for (const payload of [
          {id: 'r1', component: 'OpenBox', slot: {'@child': 'c1'}},
          {id: 'r2', component: 'OpenBox', '@action': {name: 'go'}},
          {id: 'r3', component: 'OpenBox', nested: [{call: {'@functionCall': {'@call': 'f'}}}]},
        ]) {
          assert.throws(() => strictV09.validateComponent(payload), A2uiValidationError);
        }

        // Unknown component rejects undeclared directives too.
        assert.throws(
          () =>
            allowUnknownV09.validateComponent({
              id: 'u1',
              component: 'UnknownPre10',
              child: {'@child': 'c1'},
            }),
          A2uiValidationError,
        );

        // Explicitly schema-declared @child/@action/@functionCall pre-1.0 pass validation,
        // while undeclared @-directives in sibling passthrough paths still fail.
        assert.doesNotThrow(() =>
          strictV09.validateComponent({id: 'd1', component: 'CustomAtTop', '@child': 'literal'}),
        );
        assert.doesNotThrow(() =>
          strictV09.validateComponent({
            id: 'd2',
            component: 'CustomAtNested',
            wrapper: {'@action': 'custom-val'},
            list: [{'@functionCall': 42}],
          }),
        );
        assert.throws(
          () =>
            strictV09.validateComponent({
              id: 'd3',
              component: 'CustomAtNested',
              wrapper: {'@action': 'custom-val', extra: {'@child': 'bad'}},
              list: [{'@functionCall': 42}],
            }),
          A2uiValidationError,
        );

        // Also check Catalog.fromJson pre-1.0 open vs declared.
        const v09JsonCatalog = Catalog.fromJson({
          catalogId: 'https://example.com/v09-json.json',
          protocolVersion: '0.9',
          components: {
            JsonCustom: {
              type: 'object',
              additionalProperties: true,
              properties: {
                nested: {
                  type: 'object',
                  properties: {'@child': {type: 'string'}},
                },
              },
            },
          },
        });
        const v09JsonVal = new PayloadValidator(v09JsonCatalog, STRICT_VALIDATION);
        assert.doesNotThrow(() =>
          v09JsonVal.validateComponent({
            id: 'j1',
            component: 'JsonCustom',
            nested: {'@child': 'allowed-custom'},
          }),
        );
        assert.throws(
          () =>
            v09JsonVal.validateComponent({
              id: 'j2',
              component: 'JsonCustom',
              other: {'@child': 'forbidden-undeclared'},
            }),
          A2uiValidationError,
        );
      });

      it('allows @child/@action inside custom args/context/userMessage/accessibility/checks, rejects in legacy Action slots, and ignores custom child: string', () => {
        const v1Custom = new Catalog(
          'https://example.com/v1-custom.json',
          '1.0',
          [
            {
              name: 'CustomProps',
              schema: z
                .object({
                  args: z.object({}).passthrough().optional(),
                  context: z.object({}).passthrough().optional(),
                  userMessage: z.object({}).passthrough().optional(),
                  accessibility: z.object({slot: z.any()}).optional(),
                  checks: z.array(z.any()).optional(),
                  child: z.string().optional(),
                  children: z.array(z.string()).optional(),
                })
                .passthrough(),
            },
          ],
          [
            {
              name: 'upper',
              returnType: 'string',
              schema: z.object({value: z.string()}).strict(),
            },
          ],
        );
        const validator = new PayloadValidator(v1Custom, STRICT_VALIDATION);

        // Custom properties named args/context/userMessage/accessibility/checks are NOT forced into DynamicValue mode.
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'cp1',
            component: 'CustomProps',
            args: {body: {'@child': 'c1'}},
            context: {panel: {'@child': 'c2'}},
            userMessage: {cta: {'@action': {name: 'help'}}},
            accessibility: {slot: {'@child': 'c3'}},
            checks: [{body: {'@child': 'c4'}}],
          }),
        );

        // Custom `child: string` and `children: string[]` without Child/ChildList $ref must NOT unwrap `@child`.
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'cp2',
              component: 'CustomProps',
              child: {'@child': 'c1'},
            }),
          A2uiValidationError,
        );
        assert.throws(
          () =>
            validator.validateComponent({
              id: 'cp3',
              component: 'CustomProps',
              children: {'@child': ['c1']},
            }),
          A2uiValidationError,
        );

        // Legacy Action slots on v1.0 reject @child/@action inside event.context, event.userMessage, and functionCall.args.
        const basicValidator = new PayloadValidator(v1BasicCatalog, STRICT_VALIDATION);
        for (const badBtn of [
          {
            id: 'b1',
            component: 'Button',
            child: 'lbl',
            action: {event: {name: 'tap', context: {bad: {'@child': 'x'}}}},
          },
          {
            id: 'b2',
            component: 'Button',
            child: 'lbl',
            action: {event: {name: 'tap', userMessage: {'@action': {name: 'nested'}}}},
          },
          {
            id: 'b3',
            component: 'Button',
            child: 'lbl',
            action: {functionCall: {'@call': 'upper', args: {value: {'@child': 'x'}}}},
          },
        ]) {
          assert.throws(
            () => basicValidator.validateComponent(badBtn),
            (err: unknown) =>
              err instanceof A2uiValidationError && err.code === 'INVALID_RESERVED_KEY',
          );
        }
      });
    });
  });
});
