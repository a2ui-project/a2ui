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

import type {DataBinding, DataContext, FunctionCall} from '@a2ui/web_core/v0_9';

/** Object-shaped dynamic value variants. */
export type DynamicExpression = DataBinding | FunctionCall;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks if `value` is a data binding (`{path: string}` with no extra properties). */
export function isDataBinding(value: unknown): value is DataBinding {
  return isRecord(value) && typeof value['path'] === 'string' && Object.keys(value).length === 1;
}

/** Checks if `value` is a function call (`{call: string, args?, returnType?}`). */
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

/** Checks if `value` is a data binding or function call. */
export function isDynamicExpression(value: unknown): value is DynamicExpression {
  return isDataBinding(value) || isFunctionCall(value);
}

/**
 * Recursively resolves data bindings and function calls nested inside `value`.
 * Preserves surrounding record/array structure and leaves pending Promises untouched.
 */
export function resolveDynamicValueDeep<T = unknown>(value: unknown, context: DataContext): T {
  if (!isRecord(value) && !Array.isArray(value)) {
    return value as T;
  }
  if (typeof (value as {then?: unknown}).then === 'function') {
    return value as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveDynamicValueDeep(item, context)) as unknown as T;
  }
  if (isDataBinding(value)) {
    const resolved = context.resolveDynamicValue(value);
    return isDynamicExpression(resolved)
      ? resolveDynamicValueDeep(resolved, context)
      : (resolved as T);
  }
  if (isFunctionCall(value)) {
    const resolved = context.resolveDynamicValue({...value, args: value.args ?? {}});
    return isDynamicExpression(resolved)
      ? resolveDynamicValueDeep(resolved, context)
      : (resolved as T);
  }
  return resolveDynamicRecord(value, context) as T;
}

/** Resolves each entry of a record individually without treating the record itself as a dynamic expression. */
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
