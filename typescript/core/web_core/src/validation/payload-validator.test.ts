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
import {basicCatalog as v1BasicCatalog} from '../catalogs/basic/v1/catalog.js';
import {basicCatalog as v09BasicCatalog} from '../v0_9/basic_catalog/catalog.js';
import {nestedCallRunsInCatalog, PayloadValidator} from './payload-validator.js';
import {STRICT_VALIDATION} from './integrity-checker.js';
import {A2uiValidationError} from '../errors.js';

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

    it('rejects v0.9 function calls with wrong returnType or invalid arguments (#4173)', () => {
      const jsonLoadedCatalog = Catalog.fromJson(
        v09BasicCatalog.toJson() as Record<string, unknown>,
      );
      for (const catalog of [v09BasicCatalog, jsonLoadedCatalog]) {
        const validator = new PayloadValidator(catalog, STRICT_VALIDATION);

        // Positive cases that must continue to pass
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'tf1',
            component: 'TextField',
            label: 'Input',
            value: {path: '/val'},
            checks: [
              {
                condition: {call: 'required', args: {value: {path: '/val'}}, returnType: 'boolean'},
                message: 'Req',
              },
              {
                condition: {call: 'length', args: {value: 'hello', min: 1, max: 10}},
                message: 'Len',
              },
              {
                condition: {call: 'email', args: {value: 'a@b.com'}},
                message: 'Email',
              },
            ],
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 't1',
            component: 'Text',
            text: {
              call: 'formatString',
              args: {value: 'Hello ${/user/name}'},
              returnType: 'string',
            },
          }),
        );
        assert.doesNotThrow(() =>
          validator.validateComponent({
            id: 'btn1',
            component: 'Button',
            child: 'btn-text',
            action: {
              functionCall: {
                call: 'openUrl',
                args: {url: 'https://google.com'},
                returnType: 'void',
              },
            },
          }),
        );

        // 12 negative cases from specification/v0_9_1/test/cases/
        const invalidComponents: Array<{name: string; comp: Record<string, unknown>}> = [
          {
            name: 'TextField with invalid function returnType in check',
            comp: {
              id: 'name-input',
              component: 'TextField',
              label: 'Enter your name',
              value: {path: '/formData/name'},
              checks: [
                {
                  condition: {
                    call: 'formatString',
                    args: {value: 'Hello ${/formData/name}'},
                    returnType: 'string',
                  },
                  message: 'This should fail because returnType is string, not boolean',
                },
              ],
            },
          },
          {
            name: 'required: Invalid returnType',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {call: 'required', args: {value: '${/val}'}, returnType: 'string'},
                  message: 'Req',
                },
              ],
            },
          },
          {
            name: 'formatString: Invalid returnType',
            comp: {
              id: 'text-1',
              component: 'Text',
              text: {call: 'formatString', args: {value: 'Hi'}, returnType: 'boolean'},
            },
          },
          {
            name: 'openUrl: Invalid returnType',
            comp: {
              id: 'btn-1',
              component: 'Button',
              child: 'btn-text',
              action: {
                functionCall: {
                  call: 'openUrl',
                  args: {url: 'https://google.com'},
                  returnType: 'boolean',
                },
              },
            },
          },
          {
            name: 'not: Invalid returnType',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {
                    call: 'not',
                    args: {value: {call: 'required', args: {value: '${/val}'}}},
                    returnType: 'string',
                  },
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'regex: Invalid returnType',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {
                    call: 'regex',
                    args: {value: 'abc', pattern: '.*'},
                    returnType: 'string',
                  },
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'and: Invalid returnType',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {
                    call: 'and',
                    args: {values: [true, true]},
                    returnType: 'string',
                  },
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'length: Invalid constraint (empty object)',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {call: 'length', args: {value: 'hello'}},
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'length: Invalid max value (negative)',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {call: 'length', args: {value: 'hello', max: -1}},
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'email: Invalid args count (too many)',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {
                    call: 'email',
                    args: {value: 'test@example.com', extra: 'invalid'},
                  },
                  message: 'Err',
                },
              ],
            },
          },
          {
            name: 'openUrl: Invalid URL format (not a URI)',
            comp: {
              id: 'btn-1',
              component: 'Button',
              child: 'btn-text',
              action: {
                functionCall: {
                  call: 'openUrl',
                  args: {url: 'not a uri'},
                },
              },
            },
          },
          {
            name: 'required: Too many arguments',
            comp: {
              id: 'tf-1',
              component: 'TextField',
              label: 'Input',
              value: {path: '/val'},
              checks: [
                {
                  condition: {
                    call: 'required',
                    args: {value: '${/val}', extra: 123},
                  },
                  message: 'Req',
                },
              ],
            },
          },
          {
            name: 'DateTimeInput.min (allOf DynamicString): Invalid returnType',
            comp: {
              id: 'dt-1',
              component: 'DateTimeInput',
              value: '2026-01-01',
              min: {
                call: 'formatString',
                args: {value: '2026-01-01'},
                returnType: 'number',
              },
            },
          },
        ];

        for (const {name, comp} of invalidComponents) {
          assert.throws(
            () => validator.validateComponent(comp),
            A2uiValidationError,
            `Expected A2uiValidationError for case '${name}'`,
          );
        }
      }

      for (const catalog of [
        v1BasicCatalog,
        Catalog.fromJson(v1BasicCatalog.toJson() as Record<string, unknown>),
      ]) {
        const validator = new PayloadValidator(catalog, STRICT_VALIDATION);
        assert.throws(
          () => validator.validateFunction('openUrl', {url: 'not a uri'}),
          A2uiValidationError,
        );
      }

      const oneOfCatalog = Catalog.fromJson({
        catalogId: 'https://example.com/oneof.json',
        protocolVersion: '0.9',
        components: {
          Badge: {
            type: 'object',
            properties: {
              content: {
                oneOf: [
                  {
                    type: 'object',
                    properties: {
                      kind: {const: 'num'},
                      label: {$ref: 'common_types.json#/$defs/DynamicNumber'},
                    },
                    required: ['kind', 'label'],
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    properties: {
                      kind: {const: 'str'},
                      label: {$ref: 'common_types.json#/$defs/DynamicString'},
                    },
                    required: ['kind', 'label'],
                    additionalProperties: false,
                  },
                ],
              },
              flexible: {
                anyOf: [
                  {$ref: 'common_types.json#/$defs/DynamicString'},
                  {$ref: 'common_types.json#/$defs/DynamicValue'},
                ],
              },
            },
            required: ['content'],
            additionalProperties: false,
          },
        },
        functions: {
          countItems: {
            returnType: 'number',
            parameters: {type: 'object', properties: {}, additionalProperties: false},
          },
          formatText: {
            returnType: 'string',
            parameters: {type: 'object', properties: {}, additionalProperties: false},
          },
          isFlagSet: {
            returnType: 'boolean',
            parameters: {type: 'object', properties: {}, additionalProperties: false},
          },
        },
      });
      const oneOfValidator = new PayloadValidator(oneOfCatalog, STRICT_VALIDATION);
      assert.doesNotThrow(() =>
        oneOfValidator.validateComponent({
          id: 'b-1',
          component: 'Badge',
          content: {
            kind: 'str',
            label: {
              call: 'formatText',
              args: {},
              returnType: 'string',
            },
          },
          flexible: {
            call: 'isFlagSet',
            args: {},
            returnType: 'boolean',
          },
        }),
      );
      assert.throws(
        () =>
          oneOfValidator.validateComponent({
            id: 'b-1',
            component: 'Badge',
            content: {
              kind: 'str',
              label: {
                call: 'countItems',
                args: {},
                returnType: 'number',
              },
            },
          }),
        A2uiValidationError,
      );
      assert.throws(
        () =>
          oneOfValidator.validateComponent({
            id: 'b-1',
            component: 'Badge',
            content: {
              kind: 'str',
              label: {
                call: 'isFlagSet',
                args: {},
                returnType: 'boolean',
              },
            },
          }),
        A2uiValidationError,
      );
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
  });
});
