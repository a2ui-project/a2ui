/*
 * Copyright 2025 Google LLC
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
import {effect, Signal} from '@preact/signals-core';

import {BASIC_FUNCTIONS, createBasicCatalogFunctions} from './basic_functions.js';
import {DataModel} from '../../state/data-model.js';
import {DataContext} from '../../rendering/data-context.js';
import {A2uiExpressionError} from '../../errors.js';
import {Catalog, ComponentApi} from '../../catalog/types.js';

const testCatalog = new Catalog<ComponentApi>('test', [], BASIC_FUNCTIONS);

function invoke(name: string, args: Record<string, any>, context: DataContext) {
  return testCatalog.invoker(name, args, context);
}

const createTestDataContext = (
  model: DataModel,
  path: string,
  functionInvoker: any = testCatalog.invoker,
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: functionInvoker},
    dispatchError: () => {},
  } as any;
  return new DataContext(mockSurface, path);
};

describe('BASIC_FUNCTIONS', () => {
  const dataModel = new DataModel({a: 10, b: 20});
  const context = createTestDataContext(dataModel, '/');

  describe('Arithmetic', () => {
    it('add', () => {
      assert.strictEqual(invoke('add', {a: 1, b: 2}, context), 3);
      assert.strictEqual(invoke('add', {a: '1', b: '2'}, context), 3);
      assert.throws(() => invoke('add', {a: 10, b: undefined}, context), A2uiExpressionError);
      assert.throws(() => invoke('add', {a: 10}, context), A2uiExpressionError);
    });
    it('subtract', () => {
      assert.strictEqual(invoke('subtract', {a: 5, b: 3}, context), 2);
      assert.throws(() => invoke('subtract', {a: 10, b: undefined}, context), A2uiExpressionError);
      assert.throws(() => invoke('subtract', {a: 10}, context), A2uiExpressionError);
    });
    it('multiply', () => {
      assert.strictEqual(invoke('multiply', {a: 4, b: 2}, context), 8);
      assert.throws(() => invoke('multiply', {a: 10, b: undefined}, context), A2uiExpressionError);
      assert.throws(() => invoke('multiply', {a: 10}, context), A2uiExpressionError);
    });
    it('divide', () => {
      assert.strictEqual(invoke('divide', {a: 10, b: 2}, context), 5);
      assert.strictEqual(invoke('divide', {a: 10, b: 0}, context), Infinity);
      assert.throws(() => invoke('divide', {a: 10, b: undefined}, context), A2uiExpressionError);
      assert.throws(() => invoke('divide', {a: undefined, b: 10}, context), A2uiExpressionError);
      assert.throws(
        () => invoke('divide', {a: undefined, b: undefined}, context),
        A2uiExpressionError,
      );
      assert.throws(() => invoke('divide', {a: 10, b: null}, context), A2uiExpressionError);
      assert.throws(() => invoke('divide', {a: 10, b: 'invalid'}, context), A2uiExpressionError);
      assert.strictEqual(invoke('divide', {a: 10, b: '2'}, context), 5);
      assert.strictEqual(invoke('divide', {a: '10', b: '2'}, context), 5);
    });
  });

  describe('Comparison', () => {
    it('equals', () => {
      assert.strictEqual(invoke('equals', {a: 1, b: 1}, context), true);
      assert.strictEqual(invoke('equals', {a: 1, b: 2}, context), false);
      assert.throws(() => invoke('equals', {a: 1}, context), A2uiExpressionError);
      assert.throws(() => invoke('equals', {b: 1}, context), A2uiExpressionError);
    });
    it('not_equals', () => {
      assert.strictEqual(invoke('not_equals', {a: 1, b: 2}, context), true);
      assert.throws(() => invoke('not_equals', {a: 1}, context), A2uiExpressionError);
      assert.throws(() => invoke('not_equals', {b: 1}, context), A2uiExpressionError);
    });
    it('greater_than', () => {
      assert.strictEqual(invoke('greater_than', {a: 5, b: 3}, context), true);
      assert.strictEqual(invoke('greater_than', {a: 3, b: 5}, context), false);
      assert.throws(
        () => invoke('greater_than', {a: 10, b: undefined}, context),
        A2uiExpressionError,
      );
      assert.throws(() => invoke('greater_than', {a: 10, b: null}, context), A2uiExpressionError);
      assert.throws(
        () => invoke('greater_than', {a: 10, b: 'invalid'}, context),
        A2uiExpressionError,
      );
      assert.throws(() => invoke('greater_than', {a: 10}, context), A2uiExpressionError);
      assert.throws(() => invoke('greater_than', {b: 10}, context), A2uiExpressionError);
    });
    it('less_than', () => {
      assert.strictEqual(invoke('less_than', {a: 3, b: 5}, context), true);
      assert.throws(() => invoke('less_than', {a: 3, b: undefined}, context), A2uiExpressionError);
      assert.throws(() => invoke('less_than', {a: 3, b: null}, context), A2uiExpressionError);
      assert.throws(() => invoke('less_than', {a: 3, b: 'invalid'}, context), A2uiExpressionError);
      assert.throws(() => invoke('less_than', {a: 3}, context), A2uiExpressionError);
      assert.throws(() => invoke('less_than', {b: 3}, context), A2uiExpressionError);
    });
  });

  describe('Logical', () => {
    it('and', () => {
      // Checks args['values'] array OR args['a'] && args['b'].
      assert.strictEqual(invoke('and', {values: [true, true]}, context), true);
      assert.strictEqual(invoke('and', {values: [true, false]}, context), false);
      assert.throws(() => invoke('and', {values: [true]}, context), A2uiExpressionError);
      assert.throws(() => invoke('and', {}, context), A2uiExpressionError);
    });
    it('or', () => {
      assert.strictEqual(invoke('or', {values: [false, true]}, context), true);
      assert.strictEqual(invoke('or', {values: [false, false]}, context), false);
      assert.throws(() => invoke('or', {values: [true]}, context), A2uiExpressionError);
      assert.throws(() => invoke('or', {}, context), A2uiExpressionError);
    });
    it('not', () => {
      assert.strictEqual(invoke('not', {value: false}, context), true);
      assert.strictEqual(invoke('not', {value: true}, context), false);
      assert.throws(() => invoke('not', {}, context), A2uiExpressionError);
    });
  });

  describe('String', () => {
    it('contains', () => {
      assert.strictEqual(
        invoke('contains', {string: 'hello world', substring: 'world'}, context),
        true,
      );
      assert.strictEqual(
        invoke('contains', {string: 'hello world', substring: 'foo'}, context),
        false,
      );
      assert.throws(() => invoke('contains', {string: 'hello'}, context), A2uiExpressionError);
      assert.throws(() => invoke('contains', {substring: 'hello'}, context), A2uiExpressionError);
    });
    it('starts_with', () => {
      assert.strictEqual(invoke('starts_with', {string: 'hello', prefix: 'he'}, context), true);
      assert.throws(() => invoke('starts_with', {string: 'hello'}, context), A2uiExpressionError);
      assert.throws(() => invoke('starts_with', {prefix: 'he'}, context), A2uiExpressionError);
    });
    it('ends_with', () => {
      assert.strictEqual(invoke('ends_with', {string: 'hello', suffix: 'lo'}, context), true);
      assert.throws(() => invoke('ends_with', {string: 'hello'}, context), A2uiExpressionError);
      assert.throws(() => invoke('ends_with', {suffix: 'lo'}, context), A2uiExpressionError);
    });
  });

  describe('Validation', () => {
    it('required', () => {
      assert.strictEqual(invoke('required', {value: 'a'}, context), true);
      assert.strictEqual(invoke('required', {value: ''}, context), false);
      assert.strictEqual(invoke('required', {value: null}, context), false);
      assert.throws(() => invoke('required', {}, context), A2uiExpressionError);
    });

    it('length', () => {
      assert.strictEqual(invoke('length', {value: 'abc', min: 2}, context), true);
      assert.strictEqual(invoke('length', {value: 'abc', max: 2}, context), false);
      assert.throws(() => invoke('length', {}, context), A2uiExpressionError);
    });

    it('numeric', () => {
      assert.strictEqual(invoke('numeric', {value: 10, min: 5, max: 15}, context), true);
      assert.strictEqual(invoke('numeric', {value: 3, min: 5}, context), false);
      assert.throws(() => invoke('numeric', {}, context), A2uiExpressionError);
    });

    it('email', () => {
      assert.strictEqual(invoke('email', {value: 'test@example.com'}, context), true);
      assert.strictEqual(invoke('email', {value: 'test.name@example.com'}, context), true);
      assert.strictEqual(invoke('email', {value: 'test+label@example.com'}, context), true);
      assert.strictEqual(invoke('email', {value: 'test@example-domain.com'}, context), true);

      assert.strictEqual(invoke('email', {value: 'invalid'}, context), false);
      assert.strictEqual(invoke('email', {value: 'test@test'}, context), false);
      assert.strictEqual(invoke('email', {value: 'test@test.c'}, context), false);
      assert.strictEqual(invoke('email', {value: 'test@.com'}, context), false);

      assert.throws(() => invoke('email', {}, context), A2uiExpressionError);
    });

    it('regex', () => {
      assert.strictEqual(invoke('regex', {value: 'abc', pattern: '^[a-z]+$'}, context), true);
      assert.strictEqual(invoke('regex', {value: '123', pattern: '^[a-z]+$'}, context), false);
    });

    it('regex handles invalid pattern', () => {
      assert.throws(
        () => invoke('regex', {value: 'abc', pattern: '['}, context),
        A2uiExpressionError,
      );
    });
  });

  describe('Formatting', () => {
    it('formatString (static literal)', (_, done) => {
      const result = invoke('formatString', {value: 'hello world'}, context) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // Required to pass a reference to cleanup() into th effect(). Probably
      // worth cleaning up at some point.
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'hello world');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (with data binding)', (_, done) => {
      // Assuming dataModel has { "a": 10 } from setup
      const result = invoke('formatString', {value: 'Value: ${a}'}, context) as Signal<string>;

      let emitCount = 0;
      let cleanup: (() => void) | undefined;
      // Required to pass a reference to cleanup() into th effect(). Probably
      // worth cleaning up at some point.
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        try {
          if (emitCount === 0) {
            assert.strictEqual(val, 'Value: 10');
            emitCount++;
            // Trigger a change in the next tick to avoid uninitialized sub
            setTimeout(() => {
              dataModel.set('/a', 42);
            }, 0);
          } else if (emitCount === 1) {
            assert.strictEqual(val, 'Value: 42');
            emitCount++;
            if (cleanup) cleanup();
            done();
          }
        } catch (e) {
          if (cleanup) cleanup();
          done(e);
        }
      });
    });

    it('formatString (with function call)', (_, done) => {
      // Need a functionInvoker for function calls
      const ctxWithInvoker = createTestDataContext(dataModel, '/', (name: string, args: any) => {
        if (name === 'add') {
          return Number(args['a']) + Number(args['b']);
        }
        return null;
      });

      const result = invoke(
        'formatString',
        {value: 'Result: ${add(a: 5, b: 7)}'},
        ctxWithInvoker,
      ) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // Required to pass a reference to cleanup() into th effect(). Probably
      // worth cleaning up at some point.
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'Result: 12');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (object value is JSON-stringified)', (_, done) => {
      const objModel = new DataModel({user: {name: 'Alice', age: 30}});
      const objContext = createTestDataContext(objModel, '/');

      const result = invoke('formatString', {value: 'User: ${user}'}, objContext) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'User: {"name":"Alice","age":30}');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (array value is JSON-stringified)', (_, done) => {
      const arrModel = new DataModel({tags: ['swift', 'ios']});
      const arrContext = createTestDataContext(arrModel, '/');

      const result = invoke('formatString', {value: 'Tags: ${tags}'}, arrContext) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'Tags: ["swift","ios"]');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (nested array is JSON-stringified)', (_, done) => {
      const matrixModel = new DataModel({
        matrix: [
          [1, 2],
          [3, 4],
        ],
      });
      const matrixContext = createTestDataContext(matrixModel, '/');

      const result = invoke(
        'formatString',
        {value: 'M = ${matrix}'},
        matrixContext,
      ) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'M = [[1,2],[3,4]]');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (array with null is JSON-stringified preserving nulls)', (_, done) => {
      const nullsModel = new DataModel({vals: [1, null, 3]});
      const nullsContext = createTestDataContext(nullsModel, '/');

      const result = invoke('formatString', {value: 'V = ${vals}'}, nullsContext) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'V = [1,null,3]');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatString (null/undefined interpolated as empty string)', (_, done) => {
      const nullModel = new DataModel({x: null});
      const nullContext = createTestDataContext(nullModel, '/');

      const result = invoke('formatString', {value: 'val=${x}end'}, nullContext) as Signal<string>;

      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = result.value;
        assert.strictEqual(val, 'val=end');
        if (cleanup) cleanup();
        done();
      });
    });

    it('formatNumber', () => {
      // Test basic output as Intl behavior varies by environment.
      const result = invoke('formatNumber', {value: 1234.56, decimals: 1}, context);
      assert.ok(typeof result === 'string');
      assert.ok(
        result.includes('1,234.6') || result.includes('1234.6') || result.includes('1 234,6'),
      );
    });

    it('formatCurrency', () => {
      const result = invoke('formatCurrency', {value: 1234.56, currency: 'USD'}, context);
      assert.ok(typeof result === 'string');
      assert.ok(result.includes('1,234.56') || result.includes('1234.56'));
      assert.ok(result.includes('$') || result.includes('USD'));
    });

    it('formatDate', () => {
      const result = invoke(
        'formatDate',
        {value: '2025-01-01T12:00:00Z', format: 'yyyy-MM-dd'},
        context,
      );
      assert.strictEqual(result, '2025-01-01');

      const resultISO = invoke(
        'formatDate',
        {value: '2025-01-01T12:00:00Z', format: 'ISO'},
        context,
      );
      assert.strictEqual(resultISO, '2025-01-01T12:00:00.000Z');
    });

    it('formatDate handles invalid dates', () => {
      const result = invoke('formatDate', {value: 'invalid-date', format: 'yyyy'}, context);
      assert.strictEqual(result, '');
    });

    it('formatCurrency fallback on formatting error', () => {
      const result = invoke(
        'formatCurrency',
        {value: 1234.56, currency: 'INVALID-CURRENCY', decimals: 2},
        context,
      );
      // Fallbacks to toFixed
      assert.strictEqual(result, '1234.56');
    });

    it('pluralize', () => {
      assert.strictEqual(
        invoke('pluralize', {value: 1, one: 'apple', other: 'apples'}, context),
        'apple',
      );
      assert.strictEqual(
        invoke('pluralize', {value: 2, one: 'apple', other: 'apples'}, context),
        'apples',
      );
    });

    it('pluralize with Welsh locale', () => {
      const cyCatalog = new Catalog<ComponentApi>(
        'test-cy',
        [],
        createBasicCatalogFunctions({locale: 'cy'}),
      );
      const cyContext = createTestDataContext(dataModel, '/', cyCatalog.invoker);
      // Welsh for various numbers of "cat".  Welsh because all six cases have different rules.
      const args = {
        zero: 'cathod',
        one: 'gath',
        two: 'gath',
        few: 'cath',
        many: 'chath',
        other: 'cath',
      };

      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 0}, cyContext), 'cathod');
      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 1}, cyContext), 'gath');
      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 2}, cyContext), 'gath');
      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 3}, cyContext), 'cath');
      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 6}, cyContext), 'chath');
      assert.strictEqual(cyCatalog.invoker('pluralize', {...args, value: 4}, cyContext), 'cath');
    });

    it('pluralize fallback to other', () => {
      assert.strictEqual(
        invoke('pluralize', {value: 5, one: 'apple', other: 'apples'}, context),
        'apples',
      );
      assert.strictEqual(invoke('pluralize', {value: 1, other: 'apples'}, context), 'apples');
      assert.strictEqual(invoke('pluralize', {value: 0, other: 'apples'}, context), 'apples');
    });
  });

  describe('Actions', () => {
    it('openUrl', () => {
      // Set up mock window object
      const originalWindow = (global as any).window;
      let openedUrl = '';
      let windowOpenSpecs = '';
      (global as any).window = {
        location: {href: 'https://example.com/sub/page'},
        open: (url: string, _target: string, specs: string) => {
          openedUrl = url;
          windowOpenSpecs = specs;
        },
      };

      try {
        const validCases = [
          {input: 'https://example.com', expected: 'https://example.com/'},
          {input: 'http://example.com/path', expected: 'http://example.com/path'},
          {
            input: 'https://sub.domain.co.uk:8080/p?q=1',
            expected: 'https://sub.domain.co.uk:8080/p?q=1',
          },
          {input: '/relative-path', expected: 'https://example.com/relative-path'},
          {input: 'relative/nested/path', expected: 'https://example.com/sub/relative/nested/path'},
          {input: '../parent-path', expected: 'https://example.com/parent-path'},
          {input: '?tab=profile', expected: 'https://example.com/sub/page?tab=profile'},
        ];

        const invalidCases = [
          'javascript:alert(document.domain)',
          '  javascript:alert(1)',
          'javascript://%0Aalert(1)',
          'data:text/html,<script>alert(1)</script>',
          'vbscript:msgbox("hello")',
          'file:///etc/passwd',
          'chrome://settings',
          'about:blank',
        ];

        // Verify valid cases
        for (const {input, expected} of validCases) {
          openedUrl = '';
          windowOpenSpecs = '';
          invoke('openUrl', {url: input}, context);
          assert.strictEqual(
            openedUrl,
            expected,
            `Expected input "${input}" to resolve to "${expected}"`,
          );
          assert.strictEqual(windowOpenSpecs, 'noopener,noreferrer');
        }

        // Verify invalid cases
        for (const input of invalidCases) {
          assert.throws(
            () => invoke('openUrl', {url: input}, context),
            (err: any) =>
              err instanceof A2uiExpressionError && err.message.includes('Unsupported URL scheme'),
            `Expected input "${input}" to throw an Unsupported URL scheme error`,
          );
        }

        // Verify invalid structures cause error
        assert.throws(() => invoke('openUrl', {}, context), A2uiExpressionError);
      } finally {
        (global as any).window = originalWindow;
      }
    });
  });
});
