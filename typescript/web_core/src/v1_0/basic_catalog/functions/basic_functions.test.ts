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
import fs from 'node:fs';
import path from 'node:path';

import {effect, Signal, getValue} from '../../../reactivity/signals.js';
import {
  BASIC_FUNCTIONS,
  FormatCurrencyImplementation,
  FormatDateImplementation,
  FormatNumberImplementation,
  PluralizeImplementation,
  createBasicCatalogFunctions,
  createFormatCurrencyImplementation,
} from './basic_functions.js';
import {BASIC_FUNCTION_APIS} from './basic_functions_api.js';
import {DataModel} from '../../../state/data-model.js';
import {DataContext} from '../../../rendering/data-context.js';
import {A2uiExpressionError, A2uiValidationError} from '../../../errors.js';
import {Catalog, ComponentApi} from '../../../catalog/types.js';

const testCatalog = new Catalog<ComponentApi>('test', [], BASIC_FUNCTIONS);

const createTestDataContext = (
  model: DataModel,
  contextPath: string,
  functionInvoker: any = testCatalog.invoker,
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: functionInvoker},
    dispatchError: () => {},
  } as any;
  return new DataContext(mockSurface, contextPath);
};

const dataModel = new DataModel({a: 10, b: 20});
const context = createTestDataContext(dataModel, '/');

function invoke(name: string, args: Record<string, any>, ctx: DataContext = context) {
  return testCatalog.invoker(name, args, ctx);
}

/** Reads the final value of a formatString result inside an active effect. */
function readSignal(result: unknown, assertion: (value: string) => void, done: (e?: any) => void) {
  let cleanup: (() => void) | undefined;
  // eslint-disable-next-line prefer-const
  cleanup = effect(() => {
    const value = getValue(result as Signal<string>);
    try {
      assertion(value);
      if (cleanup) cleanup();
      done();
    } catch (e) {
      if (cleanup) cleanup();
      done(e);
    }
  });
}

describe('v1.0 BASIC_FUNCTIONS catalog composition', () => {
  it('registers exactly the functions the v1.0 specification declares, plus @index', () => {
    const catalogPath = path.resolve(
      process.cwd(),
      '../../specification/v1_0/catalogs/basic/catalog.json',
    );
    const specCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const expected = [...Object.keys(specCatalog.functions), '@index'].sort();

    assert.deepStrictEqual(
      BASIC_FUNCTIONS.map(f => f.name).sort(),
      expected,
      'BASIC_FUNCTIONS has drifted from the published v1.0 catalog',
    );
  });

  it('declares an argument schema for every registered function', () => {
    const apiNames = new Set<string>(BASIC_FUNCTION_APIS.map(a => a.name));
    for (const fn of BASIC_FUNCTIONS) {
      // '@index' belongs to the '@' system namespace rather than the catalog.
      if (fn.name === '@index') continue;
      assert.ok(apiNames.has(fn.name), `${fn.name} has no matching API definition`);
    }
  });

  it('gives every registered function a callable body', () => {
    for (const fn of BASIC_FUNCTIONS) {
      assert.strictEqual(
        typeof fn.execute,
        'function',
        `${fn.name} is schema-only and would resolve to undefined at runtime`,
      );
    }
  });
});

describe('v1.0 BASIC_FUNCTIONS', () => {
  describe('Logical', () => {
    it('and returns true only when every value is truthy', () => {
      assert.strictEqual(invoke('and', {values: [true, true]}), true);
      assert.strictEqual(invoke('and', {values: [true, false]}), false);
      assert.strictEqual(invoke('and', {values: [true, true, true]}), true);
    });

    it('and rejects fewer than two values', () => {
      assert.throws(() => invoke('and', {values: [true]}), A2uiExpressionError);
      assert.throws(() => invoke('and', {}), A2uiExpressionError);
    });

    it('or returns true when at least one value is truthy', () => {
      assert.strictEqual(invoke('or', {values: [false, true]}), true);
      assert.strictEqual(invoke('or', {values: [false, false]}), false);
      assert.strictEqual(invoke('or', {values: [false, false, true]}), true);
    });

    it('or rejects fewer than two values', () => {
      assert.throws(() => invoke('or', {values: [true]}), A2uiExpressionError);
      assert.throws(() => invoke('or', {}), A2uiExpressionError);
    });

    it('not negates its argument', () => {
      assert.strictEqual(invoke('not', {value: false}), true);
      assert.strictEqual(invoke('not', {value: true}), false);
      assert.throws(() => invoke('not', {}), A2uiExpressionError);
    });
  });

  describe('Validation', () => {
    // v1.0 validation functions return a validationResult object rather than
    // the bare boolean v0.9 returned.
    it('required reports a message when the value is absent', () => {
      assert.deepStrictEqual(invoke('required', {value: 'a'}), {valid: true});
      assert.deepStrictEqual(invoke('required', {value: ''}), {
        valid: false,
        message: 'This field is required.',
      });
    });

    it('length reports which bound was crossed', () => {
      assert.deepStrictEqual(invoke('length', {value: 'abc', min: 2}), {valid: true});
      assert.deepStrictEqual(invoke('length', {value: 'abc', max: 2}), {
        valid: false,
        message: 'Maximum length is 2.',
      });
    });

    it('numeric reports which bound was crossed', () => {
      assert.deepStrictEqual(invoke('numeric', {value: 10, min: 5, max: 15}), {valid: true});
      assert.deepStrictEqual(invoke('numeric', {value: 3, min: 5}), {
        valid: false,
        message: 'Minimum value is 5.',
      });
    });

    it('email accepts addresses and rejects malformed ones', () => {
      assert.deepStrictEqual(invoke('email', {value: 'test@example.com'}), {valid: true});
      assert.deepStrictEqual(invoke('email', {value: 'invalid'}), {
        valid: false,
        message: 'Must be a valid email address.',
      });
    });

    it('regex matches against the supplied pattern', () => {
      assert.deepStrictEqual(invoke('regex', {value: 'abc', pattern: '^[a-z]+$'}), {valid: true});
      assert.deepStrictEqual(invoke('regex', {value: '123', pattern: '^[a-z]+$'}), {
        valid: false,
        message: 'Value does not match required pattern.',
      });
    });
  });

  describe('formatString', () => {
    it('passes a literal through unchanged', (_, done) => {
      readSignal(
        invoke('formatString', {value: 'hello world'}),
        v => assert.strictEqual(v, 'hello world'),
        done,
      );
    });

    it('tracks the bound value when it changes', (_, done) => {
      const model = new DataModel({a: 10});
      const ctx = createTestDataContext(model, '/');
      const result = invoke('formatString', {value: 'Value: ${a}'}, ctx) as Signal<string>;

      let emitCount = 0;
      let cleanup: (() => void) | undefined;
      // eslint-disable-next-line prefer-const
      cleanup = effect(() => {
        const val = getValue(result);
        try {
          if (emitCount === 0) {
            assert.strictEqual(val, 'Value: 10');
            emitCount++;
            setTimeout(() => model.set('/a', 42), 0);
          } else if (emitCount === 1) {
            assert.strictEqual(val, 'Value: 42');
            if (cleanup) cleanup();
            done();
          }
        } catch (e) {
          if (cleanup) cleanup();
          done(e);
        }
      });
    });

    it('resolves a nested function call', (_, done) => {
      readSignal(
        invoke('formatString', {value: 'Total: ${formatNumber(value: 1500, decimals: 0)}'}),
        v => assert.strictEqual(v, 'Total: 1,500'),
        done,
      );
    });

    it('stringifies an object as compact JSON', (_, done) => {
      const ctx = createTestDataContext(new DataModel({user: {name: 'Alice', age: 30}}), '/');
      readSignal(
        invoke('formatString', {value: 'User: ${user}'}, ctx),
        v => assert.strictEqual(v, 'User: {"name":"Alice","age":30}'),
        done,
      );
    });

    it('stringifies an array as compact JSON, preserving nulls', (_, done) => {
      const ctx = createTestDataContext(new DataModel({vals: [1, null, 3]}), '/');
      readSignal(
        invoke('formatString', {value: 'V = ${vals}'}, ctx),
        v => assert.strictEqual(v, 'V = [1,null,3]'),
        done,
      );
    });

    it('interpolates null as an empty string', (_, done) => {
      const ctx = createTestDataContext(new DataModel({x: null}), '/');
      readSignal(
        invoke('formatString', {value: 'val=${x}end'}, ctx),
        v => assert.strictEqual(v, 'val=end'),
        done,
      );
    });

    it('returns an empty string for empty input', () => {
      assert.strictEqual(invoke('formatString', {value: ''}), '');
    });
  });

  describe('formatNumber', () => {
    it('groups and rounds to the requested precision', () => {
      assert.strictEqual(invoke('formatNumber', {value: 1234.56, decimals: 1}), '1,234.6');
    });

    it('omits separators when grouping is disabled', () => {
      assert.strictEqual(
        invoke('formatNumber', {value: 1234.56, decimals: 2, grouping: false}),
        '1234.56',
      );
    });

    it('uses en-US regardless of the host locale', () => {
      // A host locale such as de-DE would render '1.234,56'. Pinning the
      // default keeps output identical to the Python reference.
      assert.strictEqual(invoke('formatNumber', {value: 1234.56, decimals: 2}), '1,234.56');
    });

    it('honours an explicit locale', () => {
      const deCatalog = new Catalog<ComponentApi>(
        'test-de',
        [],
        createBasicCatalogFunctions({locale: 'de-DE'}),
      );
      const deContext = createTestDataContext(dataModel, '/', deCatalog.invoker);
      assert.strictEqual(
        deCatalog.invoker('formatNumber', {value: 1234.56, decimals: 2}, deContext),
        '1.234,56',
      );
    });

    it('returns an empty string for NaN', () => {
      // The argument schema rejects NaN, so the guard is only reachable by
      // calling the implementation directly.
      assert.strictEqual(FormatNumberImplementation.execute({value: Number.NaN}, context), '');
    });
  });

  describe('formatCurrency', () => {
    it('formats a known ISO 4217 code with its symbol', () => {
      assert.strictEqual(invoke('formatCurrency', {value: 1234.56, currency: 'USD'}), '$1,234.56');
    });

    it('upper-cases the supplied code', () => {
      assert.strictEqual(invoke('formatCurrency', {value: 1234.56, currency: 'usd'}), '$1,234.56');
    });

    it('falls back to the code itself when Intl rejects it', () => {
      assert.strictEqual(
        invoke('formatCurrency', {value: 1234.56, currency: 'INVALID-CURRENCY', decimals: 2}),
        'INVALID-CURRENCY\u00a01,234.56',
      );
    });

    it('places a rejected code where the locale places a currency', () => {
      // Intl rejects a malformed code, so these take the fallback path. Babel
      // rejects nothing, so the Python engine lays the code out per the
      // locale's currency pattern; these are the exact strings it produces,
      // and the two engines are compared byte for byte by the conformance
      // suite. Note the U+202F grouping separator in fr-FR.
      const format = (locale: string) =>
        createFormatCurrencyImplementation(locale).execute(
          {value: 1234.56, currency: 'INVALID-CURRENCY', decimals: 2},
          context,
        );
      assert.strictEqual(format('en-US'), 'INVALID-CURRENCY\u00a01,234.56');
      assert.strictEqual(format('de-DE'), '1.234,56\u00a0INVALID-CURRENCY');
      assert.strictEqual(format('fr-FR'), '1\u202f234,56\u00a0INVALID-CURRENCY');
      assert.strictEqual(format('ja-JP'), 'INVALID-CURRENCY\u00a01,234.56');
    });

    it('leaves a well-formed but unassigned code to Intl', () => {
      // `XYZ` is unassigned but is three ASCII letters, so Intl accepts it and
      // uses it as its own symbol. It must not reach the fallback.
      assert.strictEqual(
        invoke('formatCurrency', {value: 1234.56, currency: 'XYZ', decimals: 2}),
        'XYZ\u00a01,234.56',
      );
    });

    it('returns an empty string for NaN', () => {
      assert.strictEqual(
        FormatCurrencyImplementation.execute({value: Number.NaN, currency: 'USD'}, context),
        '',
      );
    });
  });

  describe('formatDate', () => {
    // 2025-03-09 was a Sunday, which also exercises the Monday-based weekday
    // index the Python reference uses.
    const sunday = '2025-03-09T07:05:00';

    it('expands each supported TR35 token', () => {
      const cases: Array<[string, string]> = [
        ['yyyy', '2025'],
        ['yy', '25'],
        ['MMMM', 'March'],
        ['MMM', 'Mar'],
        ['MM', '03'],
        ['M', '3'],
        ['EEEE', 'Sunday'],
        ['E', 'Sun'],
        ['dd', '09'],
        ['d', '9'],
        ['HH', '07'],
        ['H', '7'],
        ['hh', '07'],
        ['h', '7'],
        ['mm', '05'],
        ['ss', '00'],
        ['a', 'AM'],
      ];
      for (const [pattern, expected] of cases) {
        assert.strictEqual(
          invoke('formatDate', {value: sunday, format: pattern}),
          expected,
          `token '${pattern}'`,
        );
      }
    });

    it('preserves literal characters between tokens', () => {
      assert.strictEqual(
        invoke('formatDate', {value: sunday, format: 'EEEE MMMM d yyyy HH:mm:ss'}),
        'Sunday March 9 2025 07:05:00',
      );
    });

    it('renders the afternoon period as PM', () => {
      assert.strictEqual(
        invoke('formatDate', {value: '2025-03-09T15:05:00', format: 'hh:mm a'}),
        '03:05 PM',
      );
    });

    it('reads a timestamp in the offset it was written with', () => {
      // 23:30+05:30 is 18:00Z. Reporting 23:30 shows the written offset wins
      // over both UTC and the host time zone.
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T23:30:00+05:30', format: 'yyyy-MM-dd HH:mm'}),
        '2025-01-01 23:30',
      );
    });

    it('reads an offset-free timestamp literally', () => {
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T23:30:00', format: 'yyyy-MM-dd HH:mm'}),
        '2025-01-01 23:30',
      );
    });

    it('emits an ISO instant for the ISO pattern', () => {
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T12:00:00Z', format: 'ISO'}),
        '2025-01-01T12:00:00.000Z',
      );
    });

    it('resolves an offset to UTC for the ISO pattern', () => {
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T12:00:00+02:00', format: 'ISO'}),
        '2025-01-01T10:00:00.000Z',
      );
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T12:00:00-05:00', format: 'ISO'}),
        '2025-01-01T17:00:00.000Z',
      );
    });

    it('reads a naive timestamp as UTC for the ISO pattern', () => {
      // Without this the result would depend on the host time zone.
      assert.strictEqual(
        invoke('formatDate', {value: '2025-01-01T12:00:00', format: 'ISO'}),
        '2025-01-01T12:00:00.000Z',
      );
    });

    it('returns an empty string for an unparseable value', () => {
      assert.strictEqual(invoke('formatDate', {value: 'invalid-date', format: 'yyyy'}), '');
    });

    it('returns an empty string for an absent value', () => {
      assert.strictEqual(invoke('formatDate', {value: '', format: 'yyyy'}), '');
    });

    it('defaults to yyyy-MM-dd when no pattern is given', () => {
      // The argument schema makes `format` required, so the default is only
      // reachable by calling the implementation directly.
      assert.strictEqual(FormatDateImplementation.execute({value: sunday}, context), '2025-03-09');
    });

    it('names months and weekdays in the configured locale', () => {
      const deCatalog = new Catalog<ComponentApi>(
        'test-de-date',
        [],
        createBasicCatalogFunctions({locale: 'de-DE'}),
      );
      const deContext = createTestDataContext(dataModel, '/', deCatalog.invoker);
      assert.strictEqual(
        deCatalog.invoker('formatDate', {value: sunday, format: 'EEEE MMMM'}, deContext),
        'Sonntag März',
      );
      // Numeric tokens read the same in any locale.
      assert.strictEqual(
        deCatalog.invoker('formatDate', {value: sunday, format: 'yyyy-MM-dd'}, deContext),
        '2025-03-09',
      );
    });
  });

  describe('pluralize', () => {
    it('selects the English one and other forms', () => {
      assert.strictEqual(invoke('pluralize', {value: 1, one: 'apple', other: 'apples'}), 'apple');
      assert.strictEqual(invoke('pluralize', {value: 2, one: 'apple', other: 'apples'}), 'apples');
      assert.strictEqual(invoke('pluralize', {value: 5, one: 'apple', other: 'apples'}), 'apples');
    });

    it('honours an explicitly empty form and falls through only when absent', () => {
      // Supplying an empty form means "render nothing" for that category.
      assert.strictEqual(invoke('pluralize', {value: 0, zero: '', other: 'cats'}), '');
      assert.strictEqual(invoke('pluralize', {value: 1, one: '', other: 'cats'}), '');
      // An absent category still falls through to other.
      assert.strictEqual(invoke('pluralize', {value: 0, other: 'cats'}), 'cats');
    });

    it('prefers an explicit zero or two form over the CLDR category', () => {
      // English CLDR maps both 0 and 2 to 'other'. An explicit form wins.
      assert.strictEqual(
        invoke('pluralize', {value: 0, zero: 'no apples', one: 'apple', other: 'apples'}),
        'no apples',
      );
      assert.strictEqual(
        invoke('pluralize', {value: 2, two: 'a pair', one: 'apple', other: 'apples'}),
        'a pair',
      );
    });

    it('falls back to other when the selected category is absent', () => {
      assert.strictEqual(invoke('pluralize', {value: 1, other: 'apples'}), 'apples');
      assert.strictEqual(invoke('pluralize', {value: 0, other: 'apples'}), 'apples');
    });

    it('returns an empty string when no form matches', () => {
      // The argument schema makes 'other' mandatory, so this last-resort
      // fallback is only reachable by calling the implementation directly.
      assert.strictEqual(PluralizeImplementation.execute({value: 1}, context), '');
    });

    it('applies the CLDR rules of an explicit locale', () => {
      const cyCatalog = new Catalog<ComponentApi>(
        'test-cy',
        [],
        createBasicCatalogFunctions({locale: 'cy'}),
      );
      const cyContext = createTestDataContext(dataModel, '/', cyCatalog.invoker);
      // Welsh, because all six CLDR categories have distinct rules.
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
  });

  describe('@index', () => {
    it('reads the iteration index from the context', () => {
      const ctx = createTestDataContext(new DataModel({items: [1, 2, 3]}), '/items/2');
      assert.strictEqual(invoke('@index', {}, ctx), 2);
      assert.strictEqual(invoke('@index', {offset: 1}, ctx), 3);
    });

    it('rejects evaluation outside a collection template', () => {
      assert.throws(
        () => invoke('@index', {}, createTestDataContext(new DataModel({}), '/')),
        A2uiValidationError,
      );
    });
  });

  describe('openUrl', () => {
    it('opens permitted schemes and rejects everything else', () => {
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

        for (const {input, expected} of validCases) {
          openedUrl = '';
          windowOpenSpecs = '';
          invoke('openUrl', {url: input});
          assert.strictEqual(openedUrl, expected, `input "${input}"`);
          assert.strictEqual(windowOpenSpecs, 'noopener,noreferrer');
        }

        for (const input of invalidCases) {
          assert.throws(
            () => invoke('openUrl', {url: input}),
            (err: any) =>
              err instanceof A2uiExpressionError && err.message.includes('Unsupported URL scheme'),
            `input "${input}"`,
          );
        }

        assert.throws(() => invoke('openUrl', {}), A2uiExpressionError);
      } finally {
        (global as any).window = originalWindow;
      }
    });

    it('does nothing when there is no window to open into', () => {
      const originalWindow = (global as any).window;
      (global as any).window = undefined;
      try {
        assert.strictEqual(invoke('openUrl', {url: 'https://example.com'}), undefined);
      } finally {
        (global as any).window = originalWindow;
      }
    });
  });

  describe('locale fallback', () => {
    // A malformed tag makes every Intl constructor throw a RangeError, and an
    // unmatched tag makes Intl format with the host's ambient locale. Both must
    // resolve to en-US, which is also where the Python engine lands, since
    // Babel raises for both.
    for (const locale of ['xx-YY', 'zz', 'en_US', '!!!']) {
      it(`formats as en-US for the unusable tag "${locale}"`, () => {
        const catalog = new Catalog<ComponentApi>(
          `test-${locale}`,
          [],
          createBasicCatalogFunctions({locale}),
        );
        const localeContext = createTestDataContext(dataModel, '/', catalog.invoker);
        const call = (name: string, args: Record<string, any>) =>
          catalog.invoker(name, args, localeContext);

        assert.strictEqual(call('formatNumber', {value: 1234.56, decimals: 2}), '1,234.56');
        assert.strictEqual(
          call('formatCurrency', {value: 1234.56, currency: 'USD', decimals: 2}),
          '$1,234.56',
        );
        assert.strictEqual(
          call('formatDate', {value: '2026-06-10T12:00:00Z', format: 'EEEE, MMMM d, yyyy'}),
          'Wednesday, June 10, 2026',
        );
        assert.strictEqual(call('pluralize', {value: 2, one: 'apple', other: 'apples'}), 'apples');
      });
    }

    it('still honours a tag Intl has data for', () => {
      const catalog = new Catalog<ComponentApi>(
        'test-de-fallback',
        [],
        createBasicCatalogFunctions({locale: 'de-DE'}),
      );
      const deContext = createTestDataContext(dataModel, '/', catalog.invoker);
      assert.strictEqual(
        catalog.invoker('formatNumber', {value: 1234.56, decimals: 2}, deContext),
        '1.234,56',
      );
    });

    it('does not crash when a malformed tag reaches the currency fallback', () => {
      // The rejected code sends formatCurrency down the getCurrencyCodeFormat
      // path, which used to construct a formatter from the raw tag and throw.
      assert.strictEqual(
        createFormatCurrencyImplementation('!!!').execute(
          {value: 1234.56, currency: 'INVALID-CURRENCY', decimals: 2},
          context,
        ),
        'INVALID-CURRENCY\u00a01,234.56',
      );
    });
  });
});
