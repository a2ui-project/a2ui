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
      assert.doesNotThrow(() =>
        validator.validateComponent({
          id: 'root',
          component: 'Tag',
          catalogId: CATALOG_ID,
          metadata: {note: 'x'},
          label: 'Hello',
        }),
      );
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
});
