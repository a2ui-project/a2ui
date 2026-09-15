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
import {
  A2uiExpressionError,
  Catalog,
  DataContext,
  DataModel,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {DATA_FUNCTIONS} from './dataFunctions.js';

const TEST_CATALOG_ID = 'https://a2ui.org/test/data-functions';

/**
 * Stands in for `callMcpTool`: a registered function whose result is only
 * available later.
 *
 * A2UI resolves a function call's arguments before invoking it and has no way
 * to await one, so an outer function receives this pending promise rather than
 * the value. Every test that exercises settling goes through the same path a
 * real tool call would.
 */
const AsyncSourceImplementation: FunctionImplementation = createFunctionImplementation(
  {
    name: 'asyncSource',
    returnType: 'any',
    schema: z.object({value: z.any()}),
  } as const,
  async args => {
    await Promise.resolve();
    return args['value'];
  },
);

const catalog = new Catalog<any>(
  TEST_CATALOG_ID,
  [],
  [...DATA_FUNCTIONS, AsyncSourceImplementation],
);

/**
 * Builds a context over a real `DataModel`, as `callMcpTool.test.ts` does.
 *
 * `onError` receives what the runtime dispatches: a nested function call
 * reports a failure to the surface instead of throwing, so a test that resolves
 * a nested payload can prove nothing was swallowed.
 */
const createTestDataContext = (
  model: DataModel,
  path = '/',
  onError: (error: unknown) => void = () => {},
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: catalog.invoker},
    dispatchError: onError,
  } as any;
  return new DataContext(mockSurface, path);
};

/** Invokes a data function against an empty model at the surface root. */
const call = (name: string, args: Record<string, unknown>) =>
  catalog.invoker(name, args, createTestDataContext(new DataModel({})));

/**
 * Fails when a value is thenable.
 *
 * A reactive binding reads a result directly, so a function handed settled
 * arguments must not wrap its answer in a promise.
 */
function assertNotThenable(value: unknown, what: string): void {
  const then = (value as {then?: unknown} | null | undefined)?.then;
  assert.strictEqual(typeof then, 'undefined', `${what} returned a thenable for settled arguments`);
}

describe('data functions', () => {
  describe('jmespath', () => {
    it('evaluates an expression against the document', () => {
      assert.deepStrictEqual(
        call('jmespath', {
          expression: 'entries[*].name',
          data: {entries: [{name: 'notes.md'}, {name: 'todo.txt'}]},
        }),
        ['notes.md', 'todo.txt'],
      );
    });

    it('yields null for a field the document omits, so an optional field is tolerated', () => {
      assert.strictEqual(call('jmespath', {expression: 'entry.size', data: {entry: {}}}), null);
    });

    it('reads null when no document is supplied', () => {
      assert.strictEqual(call('jmespath', {expression: 'anything'}), null);
    });

    // Every extension below parses in some JMESPath package. Accepting one here
    // would let a payload run on this client and fail on another, so each is
    // pinned as a parse failure.
    const unsupportedDialect: ReadonlyArray<readonly [string, string]> = [
      ['a let binding', 'let $x = `1` in $x'],
      ['a ternary', 'a ? b : c'],
      ['arithmetic', '`1` + `2`'],
      ['a root reference', '$.foo'],
    ];

    for (const [label, expression] of unsupportedDialect) {
      it(`rejects ${label}, which a stock JMESPath library does not parse`, () => {
        assert.throws(
          () => call('jmespath', {expression, data: {a: 'x', b: 'y', c: 'z', foo: 1}}),
          (error: unknown) => {
            assert.ok(error instanceof A2uiExpressionError);
            assert.strictEqual(error.expression, 'jmespath');
            assert.ok(error.message.includes(expression));
            return true;
          },
        );
      });
    }

    it('throws naming the expression when it does not parse', () => {
      assert.throws(
        () => call('jmespath', {expression: 'entries[', data: {}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.ok(error.message.includes('in JMESPath expression: entries['));
          return true;
        },
      );
    });

    it('throws naming the type when the expression is not a string', () => {
      assert.throws(
        () => call('jmespath', {expression: 42, data: {}}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.message, 'jmespath expects a string expression, got a number.');
          return true;
        },
      );
    });

    it('follows a binding that resolves to another binding to reach the expression', () => {
      // A template row names the expression to run, so the row's field holds a
      // binding and reading it yields a second binding to follow.
      const model = new DataModel({
        row: {expression: {path: '/expressions/count'}},
        expressions: {count: 'length(items)'},
      });

      const result = catalog.invoker(
        'jmespath',
        {expression: {path: '/row/expression'}, data: {items: [1, 2, 3]}},
        createTestDataContext(model),
      );

      assert.strictEqual(result, 3);
    });
  });

  describe('split', () => {
    it('splits a string on a separator', () => {
      assert.deepStrictEqual(call('split', {value: 'a,b,c', separator: ','}), ['a', 'b', 'c']);
    });

    it('splits into characters when the separator is empty', () => {
      assert.deepStrictEqual(call('split', {value: 'abc', separator: ''}), ['a', 'b', 'c']);
    });

    it('splits each element of an array, giving an array of arrays', () => {
      assert.deepStrictEqual(call('split', {value: ['a:1', 'b:2'], separator: ':'}), [
        ['a', '1'],
        ['b', '2'],
      ]);
    });
  });

  describe('regexMatch', () => {
    it('reports whether the pattern matches anywhere in the value', () => {
      assert.strictEqual(call('regexMatch', {value: 'notes.md', pattern: '\\.md$'}), true);
      assert.strictEqual(call('regexMatch', {value: 'notes.txt', pattern: '\\.md$'}), false);
    });

    it('tests each element of an array', () => {
      assert.deepStrictEqual(
        call('regexMatch', {value: ['a.md', 'b.txt', 'c.md'], pattern: '\\.md$'}),
        [true, false, true],
      );
    });

    it('answers a catastrophic-backtracking pattern in linear time', () => {
      // A backtracking engine explores 2^60 paths before rejecting this input.
      // RE2 runs in time linear in the subject, so it answers immediately.
      const subject = `${'a'.repeat(60)}!`;
      const started = Date.now();

      const result = call('regexMatch', {value: subject, pattern: '^(a+)+$'});
      const elapsed = Date.now() - started;

      assert.strictEqual(result, false);
      assert.ok(elapsed < 500, `matching took ${elapsed}ms, which is not linear time`);
    });

    it('throws naming the pattern when RE2 cannot compile it', () => {
      assert.throws(
        () => call('regexMatch', {value: 'a', pattern: '[a-'}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.strictEqual(error.expression, 'regexMatch');
          assert.ok(error.message.startsWith("Invalid RE2 pattern '[a-'"));
          return true;
        },
      );
    });

    it('throws on a backreference, which RE2 does not support', () => {
      assert.throws(
        () => call('regexMatch', {value: 'abab', pattern: '(ab)\\1'}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.ok(error.message.includes('invalid escape sequence'));
          return true;
        },
      );
    });

    it('throws on a lookahead, which RE2 does not support', () => {
      assert.throws(
        () => call('regexMatch', {value: 'foobar', pattern: 'foo(?=bar)'}),
        (error: unknown) => {
          assert.ok(error instanceof A2uiExpressionError);
          assert.ok(error.message.includes('invalid or unsupported Perl syntax'));
          return true;
        },
      );
    });
  });

  describe('regexCapture', () => {
    it('returns the capture groups of the first match', () => {
      assert.deepStrictEqual(
        call('regexCapture', {value: 'notes.md 2048', pattern: '^(\\S+) (\\d+)$'}),
        ['notes.md', '2048'],
      );
    });

    it('returns null when the pattern does not match', () => {
      assert.strictEqual(call('regexCapture', {value: 'prose', pattern: '^(\\d+)$'}), null);
    });

    it('reads a group that did not participate as an empty string', () => {
      // A result is then indexable without checking each group first.
      assert.deepStrictEqual(call('regexCapture', {value: 'a', pattern: '(a)(b)?'}), ['a', '']);
    });

    it('leaves null in place for a non-matching element, which an expression filters out', () => {
      const rows = call('regexCapture', {
        value: ['notes.md 2048', 'not a data line', 'todo.txt 91'],
        pattern: '^(\\S+) (\\d+)$',
      });

      assert.deepStrictEqual(rows, [['notes.md', '2048'], null, ['todo.txt', '91']]);
      assert.deepStrictEqual(call('jmespath', {expression: 'rows[?@ != null]', data: {rows}}), [
        ['notes.md', '2048'],
        ['todo.txt', '91'],
      ]);
    });
  });

  describe('regexReplace', () => {
    it('replaces every match, not only the first', () => {
      assert.strictEqual(
        call('regexReplace', {value: 'a1b22c', pattern: '\\d+', replacement: '#'}),
        'a#b#c',
      );
    });

    it('treats the replacement as literal text, so a group reference is not expanded', () => {
      assert.strictEqual(
        call('regexReplace', {value: 'a1', pattern: '(\\d)', replacement: '[$1]'}),
        'a[$1]',
      );
    });

    it('rewrites each element of an array', () => {
      assert.deepStrictEqual(
        call('regexReplace', {value: ['a1', 'b2'], pattern: '\\d', replacement: 'N'}),
        ['aN', 'bN'],
      );
    });
  });

  describe('updateDataModel', () => {
    it('writes several paths from one call and leaves the rest alone', () => {
      const model = new DataModel({untouched: 'kept'});

      catalog.invoker(
        'updateDataModel',
        {updates: {'/title': 'Home', '/entries': [{name: 'notes.md'}], '/count': 1}},
        createTestDataContext(model),
      );

      assert.deepStrictEqual(model.get('/'), {
        untouched: 'kept',
        title: 'Home',
        entries: [{name: 'notes.md'}],
        count: 1,
      });
    });

    it('resolves a relative path against the row scope the call was made from', () => {
      const model = new DataModel({rows: [{name: 'notes.md'}, {name: 'todo.txt'}]});

      catalog.invoker(
        'updateDataModel',
        {updates: {'selected': true, '/lastTouched': 'notes.md'}},
        createTestDataContext(model, '/rows/0'),
      );

      assert.deepStrictEqual(model.get('/'), {
        rows: [{name: 'notes.md', selected: true}, {name: 'todo.txt'}],
        lastTouched: 'notes.md',
      });
    });

    it('writes nothing when updates is null or undefined', () => {
      const model = new DataModel({kept: 'original'});
      const context = createTestDataContext(model);

      catalog.invoker('updateDataModel', {updates: null}, context);
      catalog.invoker('updateDataModel', {updates: undefined}, context);

      assert.deepStrictEqual(model.get('/'), {kept: 'original'});
    });

    // Only an object names the paths to write, so anything else is a payload
    // bug worth reporting rather than a silent no-op.
    const nonObjectUpdates: ReadonlyArray<readonly [string, unknown]> = [
      ['an array', [{'/title': 'Home'}]],
      ['a string', '/title'],
      ['a number', 42],
    ];

    for (const [label, updates] of nonObjectUpdates) {
      it(`throws naming the type when updates is ${label}`, () => {
        const model = new DataModel({kept: 'original'});

        assert.throws(
          () => catalog.invoker('updateDataModel', {updates}, createTestDataContext(model)),
          (error: unknown) => {
            assert.ok(error instanceof A2uiExpressionError);
            assert.strictEqual(error.expression, 'updateDataModel');
            assert.strictEqual(
              error.message,
              `updateDataModel expects an object of data model paths, got ${label}.`,
            );
            return true;
          },
        );
        assert.deepStrictEqual(model.get('/'), {kept: 'original'});
      });
    }
  });

  describe('settling a pending argument', () => {
    /**
     * One call per function, in a shape each accepts.
     *
     * `pendingKey` names the argument a chained call would supply, so the same
     * row drives the settled case, the pending case, and the rejected case.
     */
    interface SettlingCase {
      name: string;
      args: Record<string, unknown>;
      pendingKey: string;
      expected: unknown;
      /** Paths the call writes, for a function whose effect is the model. */
      written?: Record<string, unknown>;
    }

    const settlingCases: readonly SettlingCase[] = [
      {
        name: 'jmespath',
        args: {expression: 'rows[0]', data: {rows: ['first', 'second']}},
        pendingKey: 'data',
        expected: 'first',
      },
      {
        name: 'split',
        args: {value: 'a,b', separator: ','},
        pendingKey: 'value',
        expected: ['a', 'b'],
      },
      {
        name: 'regexMatch',
        args: {value: 'notes.md', pattern: '\\.md$'},
        pendingKey: 'value',
        expected: true,
      },
      {
        name: 'regexCapture',
        args: {value: 'notes.md', pattern: '^(\\w+)\\.(\\w+)$'},
        pendingKey: 'value',
        expected: ['notes', 'md'],
      },
      {
        name: 'regexReplace',
        args: {value: 'a1b2', pattern: '\\d', replacement: '#'},
        pendingKey: 'value',
        expected: 'a#b#',
      },
      {
        name: 'updateDataModel',
        args: {updates: {'/settled': 'yes'}},
        pendingKey: 'updates',
        expected: undefined,
        written: {'/settled': 'yes'},
      },
    ];

    for (const {name, args, pendingKey, expected, written} of settlingCases) {
      it(`${name} stays synchronous when no argument is pending`, () => {
        const model = new DataModel({});

        const result = catalog.invoker(name, args, createTestDataContext(model));

        assertNotThenable(result, name);
        assert.deepStrictEqual(result, expected);
        for (const [path, value] of Object.entries(written ?? {})) {
          assert.deepStrictEqual(model.get(path), value);
        }
      });

      it(`${name} returns a promise for its own result when an argument is pending`, async () => {
        const model = new DataModel({});
        const pending = {...args, [pendingKey]: Promise.resolve(args[pendingKey])};

        const result = catalog.invoker(name, pending, createTestDataContext(model));

        assert.strictEqual(typeof (result as {then?: unknown}).then, 'function');
        assert.deepStrictEqual(await result, expected);
        for (const [path, value] of Object.entries(written ?? {})) {
          assert.deepStrictEqual(model.get(path), value);
        }
      });

      it(`${name} propagates a rejected argument instead of swallowing it`, async () => {
        const model = new DataModel({});
        const rejected = {
          ...args,
          [pendingKey]: Promise.reject(new Error('the tool call failed')),
        };

        const result = catalog.invoker(name, rejected, createTestDataContext(model));

        await assert.rejects(async () => await result, /the tool call failed/);
        assert.deepStrictEqual(model.get('/'), {});
      });
    }

    it('settles every pending argument against its own name', async () => {
      // Two pending arguments in one call: swapping them would replace with the
      // pattern rather than the replacement, so the result pins the mapping.
      const result = await catalog.invoker(
        'regexReplace',
        {
          value: 'notes.md and todo.md',
          pattern: Promise.resolve('\\.md'),
          replacement: Promise.resolve('.txt'),
        },
        createTestDataContext(new DataModel({})),
      );

      assert.strictEqual(result, 'notes.txt and todo.txt');
    });

    it('settles a pending argument alongside a settled one', async () => {
      const result = await catalog.invoker(
        'jmespath',
        {expression: 'entries[*].name', data: Promise.resolve({entries: [{name: 'notes.md'}]})},
        createTestDataContext(new DataModel({})),
      );

      assert.deepStrictEqual(result, ['notes.md']);
    });
  });

  describe('composition through the data context', () => {
    it('carries an async tool result through split, capture, and query into the model', async () => {
      const listing = [
        '/home/wren/notes.md\t2048',
        '/home/wren/todo.txt\t91',
        'total 2 files',
      ].join('\n');

      const model = new DataModel({});
      const dispatched: unknown[] = [];
      const context = createTestDataContext(model, '/', error => dispatched.push(error));

      // The payload an agent writes: nested `{call, args}` values, resolved by
      // the runtime from the inside out, with only the innermost call async.
      const result = context.resolveDynamicValue({
        call: 'updateDataModel',
        args: {
          updates: {
            call: 'jmespath',
            args: {
              expression:
                '[?@ != null] | {"/files": [*].{path: [0], size: to_number([1])}, "/count": length(@)}',
              data: {
                call: 'regexCapture',
                args: {
                  value: {
                    call: 'split',
                    args: {
                      value: {call: 'asyncSource', args: {value: listing}},
                      separator: '\n',
                    },
                  },
                  pattern: '^(\\S+)\\t(\\d+)$',
                },
              },
            },
          },
        },
        // `returnType` is optional in the spec but required by the inferred
        // type, so the payload is cast rather than padded with a field an agent
        // would not write.
      } as any);

      // Nothing is written until the tool result arrives.
      assert.deepStrictEqual(model.get('/'), {});
      await result;

      assert.deepStrictEqual(model.get('/'), {
        files: [
          {path: '/home/wren/notes.md', size: 2048},
          {path: '/home/wren/todo.txt', size: 91},
        ],
        count: 2,
      });
      // A nested call reports failures to the surface rather than throwing, so
      // an empty list is what proves the chain ran end to end.
      assert.deepStrictEqual(dispatched, []);
    });

    it('sends a nested failure to the surface instead of throwing it', () => {
      const model = new DataModel({});
      const dispatched: Array<{message: string}> = [];
      const context = createTestDataContext(model, '/', error =>
        dispatched.push(error as {message: string}),
      );

      const result = context.resolveDynamicValue({
        call: 'updateDataModel',
        args: {updates: {call: 'jmespath', args: {expression: 'entries[', data: {}}}},
      } as any);

      // The outer call still runs, on an argument the failure left undefined.
      assert.strictEqual(result, undefined);
      assert.deepStrictEqual(model.get('/'), {});
      assert.strictEqual(dispatched.length, 1);
      assert.match(dispatched[0].message, /in JMESPath expression: entries\[/);
    });
  });
});
