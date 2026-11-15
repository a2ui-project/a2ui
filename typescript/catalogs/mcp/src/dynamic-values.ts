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
 * Type guards and recursive resolution utilities for A2UI dynamic values.
 *
 * While `DataContext.resolveDynamicValue` resolves a single top-level `DynamicValue`,
 * these helpers recursively traverse nested objects and arrays to resolve embedded
 * data bindings and function calls.
 */

import type {DataBinding, DataContext, FunctionCall} from '@a2ui/web_core/v0_9';

/** Union of dynamic expression types (`DataBinding` or `FunctionCall`) that require runtime evaluation. */
export type DynamicExpression = DataBinding | FunctionCall;

/** Maximum recursion depth when resolving nested dynamic values to prevent infinite loops. */
const MAX_RESOLUTION_DEPTH = 100;

/** Checks whether a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The key of a data binding's path: `@path` from protocol v1.0, `path` before. */
function pathKey(atLeastV10: boolean): string {
  return atLeastV10 ? '@path' : 'path';
}

/** The key of a function call's name: `@call` from protocol v1.0, `call` before. */
export function callKey(atLeastV10: boolean): string {
  return atLeastV10 ? '@call' : 'call';
}

/**
 * Checks whether `value` is a `DataBinding`: `{path: string}`, or `{"@path": string}` when
 * `atLeastV10`.
 *
 * Objects with additional properties alongside the path are treated as literal objects.
 */
export function isDataBinding(value: unknown, atLeastV10 = false): value is DataBinding {
  return (
    isRecord(value) &&
    typeof value[pathKey(atLeastV10)] === 'string' &&
    Object.keys(value).length === 1
  );
}

/**
 * Checks whether `value` is a `FunctionCall`: `{call: string, args?, returnType?}`, or
 * `{"@call": string, args?, returnType?}` when `atLeastV10`.
 */
export function isFunctionCall(value: unknown, atLeastV10 = false): value is FunctionCall {
  if (!isRecord(value) || typeof value[callKey(atLeastV10)] !== 'string') {
    return false;
  }
  const args = value['args'];
  const returnType = value['returnType'];
  return (
    (args === undefined || isRecord(args)) &&
    (returnType === undefined || typeof returnType === 'string')
  );
}

/** Checks whether `value` is a `DataBinding` or a `FunctionCall`, in the spelling of the version. */
export function isDynamicExpression(
  value: unknown,
  atLeastV10 = false,
): value is DynamicExpression {
  return isDataBinding(value, atLeastV10) || isFunctionCall(value, atLeastV10);
}

/**
 * Recursively resolves all dynamic expressions (`DataBinding` and `FunctionCall`)
 * nested within `value`.
 *
 * Traverses arrays and plain objects while preserving their structure, and
 * repeatedly resolves chained expressions until a concrete value is reached or
 * `MAX_RESOLUTION_DEPTH` is hit. Pending Promises from async functions are
 * passed through as-is.
 *
 * @param value The value or container to resolve.
 * @param context The data context used for evaluation.
 * @param depth Internal recursion depth counter.
 */
export function resolveDynamicValueDeep<T = unknown>(
  value: unknown,
  context: DataContext,
  depth = 0,
): T {
  if (depth >= MAX_RESOLUTION_DEPTH) {
    return value as T;
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return value as T;
  }
  if (typeof (value as {then?: unknown}).then === 'function') {
    return value as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveDynamicValueDeep(item, context, depth + 1)) as unknown as T;
  }
  // A v1.0 context resolves the v1.0 spelling (`@path`, `@call`); the other is a literal object.
  const atLeastV10 = context.atLeastV10;
  if (isDataBinding(value, atLeastV10)) {
    const key = pathKey(atLeastV10);
    const resolved = context.resolveDynamicValue(value);
    // Stop if the binding could not be resolved to avoid an infinite loop.
    if (
      resolved === value ||
      (isDataBinding(resolved, atLeastV10) &&
        (resolved as Record<string, unknown>)[key] === (value as Record<string, unknown>)[key])
    ) {
      return resolved as unknown as T;
    }
    return resolveDynamicValueDeep(resolved, context, depth + 1);
  }
  if (isFunctionCall(value, atLeastV10)) {
    // Supply default values for optional `args` and `returnType` fields before resolving.
    const dynamicCall =
      value.args !== undefined && value.returnType !== undefined
        ? value
        : ({
            ...value,
            args: value.args ?? {},
            returnType: value.returnType ?? 'any',
          } as FunctionCall);
    const resolved = context.resolveDynamicValue(dynamicCall);
    if (resolved === value || resolved === dynamicCall) {
      return resolved as unknown as T;
    }
    return resolveDynamicValueDeep(resolved, context, depth + 1);
  }
  return resolveDynamicRecord(value, context, depth) as T;
}

/**
 * Resolves each property value in a key-value record (such as function arguments).
 *
 * Resolves entries individually rather than evaluating the record itself as a
 * dynamic expression, so records containing `path` or `call` keys (`@path` or `@call` from
 * v1.0) are preserved as plain objects.
 */
export function resolveDynamicRecord(
  record: Record<string, unknown>,
  context: DataContext,
  depth = 0,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveDynamicValueDeep(value, context, depth + 1);
  }
  return resolved;
}
