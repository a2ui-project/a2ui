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
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks whether `value` is a `DataBinding` (`{path: string}`).
 *
 * Objects with additional properties alongside `path` are treated as literal objects.
 */
export function isDataBinding(value: unknown): value is DataBinding {
  return isRecord(value) && typeof value['path'] === 'string' && Object.keys(value).length === 1;
}

/**
 * Checks whether `value` is a `FunctionCall` (`{call: string, args?, returnType?}`).
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

/** Checks whether `value` is a `DataBinding` or a `FunctionCall`. */
export function isDynamicExpression(value: unknown): value is DynamicExpression {
  return isDataBinding(value) || isFunctionCall(value);
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
  if (isDataBinding(value)) {
    const resolved = context.resolveDynamicValue(value);
    // Stop if the binding could not be resolved to avoid an infinite loop.
    if (resolved === value) {
      return resolved as unknown as T;
    }
    return resolveDynamicValueDeep(resolved, context, depth + 1);
  }
  if (isFunctionCall(value)) {
    // Supply default values for optional `args` and `returnType` fields before resolving.
    const dynamicCall =
      value.args !== undefined && value.returnType !== undefined
        ? value
        : {
            call: value.call,
            args: value.args ?? {},
            returnType: value.returnType ?? 'any',
          };
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
 * dynamic expression, so records containing `path` or `call` keys are preserved
 * as plain objects.
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
