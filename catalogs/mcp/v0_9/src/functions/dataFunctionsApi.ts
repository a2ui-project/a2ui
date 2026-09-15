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
 * Argument schemas for the data functions.
 *
 * These live apart from the implementations so a host can publish the catalog
 * without pulling in an expression evaluator or a regular expression engine.
 *
 * ## Why several arguments are typed loosely
 *
 * A2UI resolves a function call's arguments before invoking it, and an argument
 * may itself be a function call. When the inner call is asynchronous, as
 * `callMcpTool` is, the runtime has nothing to await it with and hands the
 * outer function the pending `Promise` instead of the value. The data functions
 * accept that and settle it themselves, so every argument that can receive the
 * output of another function is declared with `asyncable`.
 *
 * A payload author never writes a promise. The published catalog schema
 * therefore states the plain type, which is what the author must supply.
 *
 * The same reasoning sets every return type to `any`: a function handed a
 * pending argument returns a promise for its own result, so no narrower type
 * describes both cases. The description of each function states what it
 * produces once its arguments have settled.
 */

import {z} from 'zod';

/** Reports whether a value is thenable, which is how a pending argument arrives. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/**
 * Widens a schema to also admit a pending argument.
 *
 * The sync case keeps its validation. The async case cannot be checked here,
 * because the value does not exist yet, so the implementation re-checks it
 * after the promise settles.
 */
function asyncable<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.custom<PromiseLike<unknown>>(isThenable)]);
}

/** A string argument, or a string-producing text of any shape, or an array of them. */
const TextInput = asyncable(z.any());

/**
 * What an author needs to know to write an expression, published verbatim in
 * the catalog schema so a model generating a payload reads it too.
 */
export const JMESPATH_LANGUAGE_DESCRIPTION = [
  'A JMESPath expression, as specified at jmespath.org, evaluated against `data`.',
  '',
  'The dialect is the original grammar and nothing more, so an expression runs',
  'unchanged on any client with a stock JMESPath library. Extensions some',
  'libraries add are not available: there are no `let` bindings, no ternary',
  '`? :`, no arithmetic operators, and no `$` root reference.',
  '',
  'There are no regular expressions and no `split` inside an expression. Call',
  'the `split`, `regexMatch`, `regexCapture`, and `regexReplace` functions',
  'first and pass their output in as `data`.',
  '',
  'Two idioms cover what the missing syntax would do:',
  '  Conditionals. Write `(cond && valueIfTrue) || valueIfFalse`. Both branches',
  '  must be truthy values; an empty string, empty array, empty object, null,',
  '  and false are all falsy.',
  '  Intermediate values. Pipe into a multi-select hash to name subresults,',
  '  then read them by name: `{n: length(rows)} | {"/count": n}`.',
  '',
  'Use `rows[*]` to map over a list. `rows[]` flattens one level instead, which',
  'is rarely what a list of rows wants. Filter with `rows[?@ != null]`.',
  '',
  'A projection rebinds the current node, and there is no root reference, so a',
  'value at the top of `data` is not visible inside `rows[*].{...}`. Build such',
  'a value in the component instead: a template row can read an absolute path,',
  'so `formatString` with `${/dir}/${name}` joins a value held once to a field',
  'held per row.',
].join('\n');

export const JmespathApi = {
  name: 'jmespath',
  returnType: 'any',
  schema: z.object({
    expression: asyncable(z.any()).describe(JMESPATH_LANGUAGE_DESCRIPTION),
    data: asyncable(z.any()).describe('The document the expression reads.'),
  }),
} as const;

export const SplitApi = {
  name: 'split',
  returnType: 'any',
  schema: z.object({
    value: TextInput.describe(
      'The string to split. An array is split element by element, giving an array of arrays.',
    ),
    separator: asyncable(z.any()).describe(
      'The separator to split on. An empty separator splits into characters.',
    ),
  }),
} as const;

export const RegexMatchApi = {
  name: 'regexMatch',
  returnType: 'any',
  schema: z.object({
    value: TextInput.describe(
      'The string to test. An array is tested element by element, giving an array of booleans.',
    ),
    pattern: asyncable(z.any()).describe('An RE2 pattern. True when it matches anywhere in value.'),
  }),
} as const;

export const RegexCaptureApi = {
  name: 'regexCapture',
  returnType: 'any',
  schema: z.object({
    value: TextInput.describe(
      'The string to match. An array is matched element by element, giving an array of results.',
    ),
    pattern: asyncable(z.any()).describe(
      'An RE2 pattern. The result is the capture groups of the first match, or null when the pattern does not match. A group that did not participate reads as an empty string.',
    ),
  }),
} as const;

export const RegexReplaceApi = {
  name: 'regexReplace',
  returnType: 'any',
  schema: z.object({
    value: TextInput.describe('The string to rewrite. An array is rewritten element by element.'),
    pattern: asyncable(z.any()).describe('An RE2 pattern. Every match is replaced.'),
    replacement: asyncable(z.any()).describe(
      'Literal replacement text. A group reference such as $1 is not expanded.',
    ),
  }),
} as const;

export const UpdateDataModelApi = {
  name: 'updateDataModel',
  returnType: 'any',
  schema: z.object({
    updates: asyncable(z.any()).describe(
      'An object whose keys are data model paths and whose values are what to write there, for example {"/entries": [...], "/title": "Home"}. A key starting with "/" is absolute; a relative key resolves against the data context the call was made from, which is the row scope when the call came from a template list.',
    ),
  }),
} as const;

/** Every data function API, in the order the catalog lists them. */
export const DATA_FUNCTION_APIS = [
  JmespathApi,
  SplitApi,
  RegexMatchApi,
  RegexCaptureApi,
  RegexReplaceApi,
  UpdateDataModelApi,
] as const;
