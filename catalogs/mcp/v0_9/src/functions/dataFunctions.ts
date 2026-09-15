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

/**
 * Six small functions that compose into the step a UI payload actually needs:
 * take what a tool returned, reshape it, and write it into the data model.
 *
 * ```json
 * {"call": "updateDataModel", "args": {"updates": {
 *   "call": "jmespath", "args": {
 *     "expression": "...",
 *     "data": {"call": "callMcpTool", "args": {"name": "list_directory"}}}}}}
 * ```
 *
 * ## Why the query language is JMESPath, and why the stock package
 *
 * JMESPath is specified at jmespath.org and implemented in many languages, so
 * an expression written in an A2UI payload runs the same on a client that is
 * not this one. This module evaluates with `jmespath`, the reference JavaScript
 * implementation, which accepts the original grammar and nothing else. Dialect
 * extensions that other packages add, such as `let` bindings, a `? :` ternary,
 * arithmetic, and a `$` root reference, fail to parse. Using the reference
 * implementation is therefore the portability guarantee: there is no separate
 * grammar check to keep in step, because the evaluator is the specification.
 *
 * The language is also total. It has no loops, no recursion, and no way to
 * reach the host, so an expression cannot run away or escape the document it
 * was given.
 *
 * ## Why string work is not inside the expression
 *
 * Stock JMESPath has no regular expressions and no `split`. Rather than
 * register extension functions into the evaluator, which would make A2UI
 * expressions unportable in exactly the way the previous paragraph rules out,
 * the string work is separate A2UI functions that run before the expression
 * does. A payload splits and captures first, then queries the result.
 *
 * This keeps a second promise as well. Regular expressions run on RE2, which
 * matches in time linear in the input and so cannot be made to hang by a
 * crafted pattern. RE2 has no backreferences and no lookaround; a pattern using
 * either fails rather than running.
 *
 * ## Applying to an array
 *
 * `split`, `regexMatch`, `regexCapture`, and `regexReplace` each accept an
 * array and apply element by element. Splitting text into lines and capturing
 * fields from every line is therefore two calls rather than a loop, which the
 * language does not have.
 *
 * ## Composing across an asynchronous call
 *
 * A2UI resolves a function call's arguments before it invokes the function, and
 * it has no way to await one. An argument that is a pending `callMcpTool`
 * therefore arrives as a `Promise`, and the runtime never revisits it. Each
 * function here settles its own arguments, which is what lets a synchronous
 * function sit above an asynchronous one. A call whose arguments are all
 * settled stays synchronous, so these functions remain usable from a reactive
 * binding, which cannot consume a promise.
 *
 * One consequence is worth knowing: `DataContext` catches a failure in a nested
 * call and reports it to the surface rather than rethrowing, then invokes the
 * outer function with `undefined` for that argument. A bad expression produces
 * an error event, not a failed write.
 *
 * ## Reaching a value outside a projection
 *
 * A JMESPath projection rebinds the current node, and the original grammar has
 * no root reference, so a value at the top of the document is not visible
 * inside `rows[*].{...}`. Build such a value in the component instead: a
 * template row can read an absolute path, so
 * `{"call": "formatString", "args": {"value": "${/dir}/${name}"}}` joins a
 * value held once to a field held per row.
 */

import {
  A2uiExpressionError,
  createFunctionImplementation,
  type DataContext,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {search as searchJmespath} from 'jmespath';
import {RE2JS} from 're2js';

import {resolveDynamicValueDeep} from '../dynamic-values.js';
import {
  JmespathApi,
  RegexCaptureApi,
  RegexMatchApi,
  RegexReplaceApi,
  SplitApi,
  UpdateDataModelApi,
  isThenable,
} from './dataFunctionsApi.js';

/**
 * Replaces every pending value inside `value` with what it settles to.
 *
 * A2UI resolves a function call's arguments before it invokes the function, but
 * it has no way to await one, so an argument that is another function's result
 * arrives as a `Promise`. The search is deep because a document argument
 * combines them: `{"rows": {"call": "split", ...}, "dir": "~"}` holds one
 * pending value beside a literal.
 *
 * When nothing is pending the value is returned unchanged and the caller stays
 * synchronous, which matters because a reactive binding cannot use a promise.
 */
function settleDeep(value: unknown): unknown | Promise<unknown> {
  if (isThenable(value)) {
    return Promise.resolve(value).then(settleDeep);
  }
  if (Array.isArray(value)) {
    const items = value.map(settleDeep);
    return items.some(isThenable) ? Promise.all(items) : value;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, settleDeep(item)] as const);
    if (!entries.some(([, item]) => isThenable(item))) {
      return value;
    }
    return Promise.all(entries.map(([, item]) => item)).then(settled =>
      Object.fromEntries(entries.map(([key], i) => [key, settled[i]])),
    );
  }
  return value;
}

/** Narrows to an object worth descending into, excluding class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Runs `body` once every argument has a value.
 *
 * The call stays synchronous when nothing is pending, so these functions remain
 * usable from a reactive binding and not only from an action.
 */
function withSettledArgs<T>(
  args: Record<string, unknown>,
  body: (settled: Record<string, unknown>) => T,
): T | Promise<T> {
  const settled = settleDeep(args);
  return isThenable(settled)
    ? Promise.resolve(settled).then(value => body(value as Record<string, unknown>))
    : body(settled as Record<string, unknown>);
}

/**
 * Compiled patterns, keyed by source.
 *
 * Compiling an RE2 pattern costs an order of magnitude more than matching with
 * it, and these functions apply one pattern across every element of an array,
 * so the same source is compiled once and reused.
 */
const compiledPatterns = new Map<string, ReturnType<typeof RE2JS.compile>>();

function pattern(source: string, fn: string): ReturnType<typeof RE2JS.compile> {
  let compiled = compiledPatterns.get(source);
  if (!compiled) {
    try {
      compiled = RE2JS.compile(source);
    } catch (error) {
      throw new A2uiExpressionError(
        `Invalid RE2 pattern '${source}': ${error instanceof Error ? error.message : error}`,
        fn,
        error,
      );
    }
    compiledPatterns.set(source, compiled);
  }
  return compiled;
}

/** Coerces to the string the regular expression functions operate on. */
function text(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

/** Applies `fn` to `value`, or to each element when `value` is an array. */
function overValue<T>(value: unknown, fn: (item: string) => T): T | T[] {
  return Array.isArray(value) ? value.map(item => fn(text(item))) : fn(text(value));
}

/**
 * Evaluates a JMESPath expression against a document.
 *
 * An expression that reads a missing field yields null rather than failing,
 * which is JMESPath's own behaviour and lets a payload tolerate a tool that
 * omits an optional field.
 */
export const JmespathImplementation: FunctionImplementation = createFunctionImplementation(
  JmespathApi,
  (args, context) => {
    // A2UI resolves an argument that is a function call, but leaves a literal
    // object holding one alone. Resolving here lets a payload assemble the
    // document from several sources, which is how a value that a projection
    // cannot reach gets alongside the rows it belongs to:
    // `{"rows": {"call": "split", ...}, "dir": {"path": "/dir"}}`.
    const document = resolveDynamicValueDeep<unknown>(args['data'], context);
    return withSettledArgs({expression: args['expression'], data: document}, settled => {
      // The expression is commonly held in the data model and reached through a
      // binding that resolves to another binding, as a template row does when
      // each row names the expression to run. One resolve pass returns the
      // inner binding, so the chain is followed here.
      const expression = resolveDynamicValueDeep<unknown>(settled['expression'], context);
      if (typeof expression !== 'string') {
        throw new A2uiExpressionError(
          `jmespath expects a string expression, got ${describe(expression)}.`,
          'jmespath',
        );
      }
      try {
        return searchJmespath(settled['data'] ?? null, expression);
      } catch (error) {
        throw new A2uiExpressionError(
          `${error instanceof Error ? error.message : String(error)} in JMESPath expression: ${expression}`,
          'jmespath',
          error,
        );
      }
    });
  },
);

/** Splits a string, or each element of an array, on a separator. */
export const SplitImplementation: FunctionImplementation = createFunctionImplementation(
  SplitApi,
  args =>
    withSettledArgs(args, settled => {
      const separator = text(settled['separator']);
      return overValue(settled['value'], item => item.split(separator));
    }),
);

/** Reports whether a pattern matches anywhere in the value. */
export const RegexMatchImplementation: FunctionImplementation = createFunctionImplementation(
  RegexMatchApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(text(settled['pattern']), 'regexMatch');
      return overValue(settled['value'], item => compiled.matcher(item).find());
    }),
);

/**
 * Returns the capture groups of the first match, or null when nothing matches.
 *
 * A group that did not participate reads as an empty string, so a result can be
 * indexed without checking each group. Over an array, a non-matching element
 * yields null in place, which an expression drops with `[?@ != null]`.
 */
export const RegexCaptureImplementation: FunctionImplementation = createFunctionImplementation(
  RegexCaptureApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(text(settled['pattern']), 'regexCapture');
      return overValue(settled['value'], item => {
        const matcher = compiled.matcher(item);
        if (!matcher.find()) {
          return null;
        }
        const groups: string[] = [];
        for (let i = 1; i <= matcher.groupCount(); i++) {
          groups.push(matcher.group(i) ?? '');
        }
        return groups;
      });
    }),
);

/** Replaces every match of a pattern with literal text. */
export const RegexReplaceImplementation: FunctionImplementation = createFunctionImplementation(
  RegexReplaceApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(text(settled['pattern']), 'regexReplace');
      const replacement = RE2JS.quoteReplacement(text(settled['replacement']));
      return overValue(settled['value'], item => compiled.matcher(item).replaceAll(replacement));
    }),
);

/**
 * Writes an object of data model paths into the calling surface.
 *
 * Each key is written on its own, so one call can fill several parts of the
 * model and leave the rest alone. A relative key resolves against the data
 * context the call ran in, which is the row's own scope when the call came from
 * a template list.
 */
export const UpdateDataModelImplementation: FunctionImplementation = createFunctionImplementation(
  UpdateDataModelApi,
  (args, context) => {
    // Resolved here for the same reason as `jmespath`'s document: writing one
    // path from a tool call and another from a plain binding is one literal
    // object whose values A2UI leaves untouched.
    const requested = resolveDynamicValueDeep<unknown>(args['updates'], context);
    return withSettledArgs({updates: requested}, settled => {
      const updates = settled['updates'];
      if (updates === null || updates === undefined) {
        return;
      }
      if (typeof updates !== 'object' || Array.isArray(updates)) {
        throw new A2uiExpressionError(
          `updateDataModel expects an object of data model paths, got ${describe(updates)}.`,
          'updateDataModel',
        );
      }
      for (const [path, value] of Object.entries(updates as Record<string, unknown>)) {
        // A structural copy drops anything the evaluator carried that a
        // renderer should not read, such as an object on a null prototype.
        context.set(path, value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
      }
    });
  },
);

/** Names a value's type for an error message. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * The data functions, ready to register alongside `callMcpTool`.
 *
 * They hold no state beyond the pattern cache and read the surface only through
 * the `DataContext` they are handed, so one array can serve every surface.
 */
export const DATA_FUNCTIONS: FunctionImplementation[] = [
  JmespathImplementation,
  SplitImplementation,
  RegexMatchImplementation,
  RegexCaptureImplementation,
  RegexReplaceImplementation,
  UpdateDataModelImplementation,
];

export type {DataContext};
