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
 * Structural guards and deep resolution helpers for A2UI dynamic values.
 *
 * `DataContext.resolveDynamicValue` resolves a single `DynamicValue`: a literal,
 * a data binding, or a function call. Catalog functions that accept free-form
 * payloads additionally need to walk literal containers (records and arrays)
 * and resolve any bindings nested inside them, which is what this module adds.
 *
 * The helpers here are deliberately free of catalog-specific logic so the file
 * can move to `renderers/web_core/src/v0_9/rendering/` unchanged.
 */

import type {DataBinding, DataContext, FunctionCall} from '@a2ui/web_core/v0_9';

/**
 * The two object-shaped members of `DynamicValue`: everything else in the union
 * (string, number, boolean, array) is a literal.
 */
export type DynamicExpression = DataBinding | FunctionCall;

/** Narrows to a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reports whether `value` is a data binding: `{path: string}`.
 *
 * `common_types.json#/$defs/DataBinding` sets `additionalProperties: false`, so
 * an object carrying a `path` alongside other keys is a literal, not a binding.
 */
export function isDataBinding(value: unknown): value is DataBinding {
  return isRecord(value) && typeof value['path'] === 'string' && Object.keys(value).length === 1;
}

/**
 * Reports whether `value` is a function call: `{call: string, args?, returnType?}`.
 *
 * `common_types.json#/$defs/FunctionCall` requires only `call`, so the string
 * type of `call` is the discriminator. `args` and `returnType` are validated
 * when present to keep malformed payloads from being invoked as functions.
 */
export function isFunctionCall(value: unknown): value is FunctionCall {
  if (!isRecord(value) || typeof value['call'] !== 'string') {
    return false;
  }
  const args = value['args'];
  const returnType = value['returnType'];
  return (
    (args === undefined || isRecord(args)) &&
    (returnType === undefined || typeof returnType === 'string')
  );
}

/** Reports whether `value` is a data binding or a function call. */
export function isDynamicExpression(value: unknown): value is DynamicExpression {
  return isDataBinding(value) || isFunctionCall(value);
}

/**
 * Resolves every dynamic expression nested anywhere inside `value`.
 *
 * Literal records and arrays are rebuilt entry by entry so bindings inside them
 * are resolved while the surrounding literal structure is preserved. Values
 * that are not dynamic expressions are returned as-is.
 *
 * Like `DataContext.resolveDynamicValue`, this evaluates once and creates no
 * reactive subscriptions.
 */
export function resolveDynamicValueDeep<T = unknown>(value: unknown, context: DataContext): T {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveDynamicValueDeep(item, context)) as unknown as T;
  }
  if (isDataBinding(value)) {
    return context.resolveDynamicValue(value);
  }
  if (isFunctionCall(value)) {
    // `args` is optional in the spec but required by the resolver.
    return context.resolveDynamicValue({...value, args: value.args ?? {}});
  }
  return resolveDynamicRecord(value, context) as T;
}

/**
 * Resolves each entry of a record of dynamic values, such as `FunctionCall.args`
 * or a catalog function's arguments object.
 *
 * The record itself is data, not a dynamic value, so entries are resolved
 * individually. This keeps a record whose keys happen to be named `path` or
 * `call` from being mistaken for a single binding or function call.
 */
export function resolveDynamicRecord(
  record: Record<string, unknown>,
  context: DataContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveDynamicValueDeep(value, context);
  }
  return resolved;
}
