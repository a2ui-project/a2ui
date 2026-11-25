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

import {FailedArgument, isPlainObject, isThenable} from '../common/settle_deep.js';
import {A2uiExpressionError} from '../errors.js';
import {computed, getValue, isSignal, type Signal} from '../reactivity/signals.js';
import type {A2uiReturnType} from './types.js';

const VALIDATED_RETURN_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'validationResult',
  'void',
]);

const VALIDATION_SEVERITIES: ReadonlySet<unknown> = new Set(['error', 'warning', 'info']);

/**
 * Returns whether `returnType` is a standard A2UI v1.0 return type that requires
 * runtime validation.
 *
 * `'any'` and custom catalog extension return types accept any resolved value.
 *
 * @param returnType Declared catalog return type identifier.
 * @returns Whether resolved results must be checked against `returnType`.
 */
export function needsReturnTypeValidation(returnType: A2uiReturnType): boolean {
  return VALIDATED_RETURN_TYPES.has(returnType);
}

/**
 * Validates a resolved value against a standard A2UI v1.0 `returnType` without
 * performing any type coercion.
 *
 * @param returnType Declared catalog return type identifier.
 * @param value Resolved runtime value to inspect.
 * @returns Whether `value` satisfies `returnType`.
 */
export function isValidReturnTypeValue(returnType: A2uiReturnType, value: unknown): boolean {
  switch (returnType) {
    case 'any':
      return true;
    case 'void':
      return value === undefined || value === null;
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    case 'validationResult':
      return isValidValidationResult(value);
    default:
      return true;
  }
}

function isValidValidationResult(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value['valid'] !== 'boolean') {
    return false;
  }
  if (value['code'] !== undefined && typeof value['code'] !== 'string') {
    return false;
  }
  if (value['message'] !== undefined && typeof value['message'] !== 'string') {
    return false;
  }
  if (value['severity'] !== undefined && !VALIDATION_SEVERITIES.has(value['severity'])) {
    return false;
  }
  return true;
}

function describeRuntimeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? 'number' : String(value);
  }
  if (typeof value === 'object') {
    if (isPlainObject(value)) {
      return 'object';
    }
    const ctorName = (value as {constructor?: {name?: string}}).constructor?.name;
    return ctorName || 'object';
  }
  return typeof value;
}

/**
 * Asserts that a resolved function return value conforms to its catalog
 * `returnType` without coercion.
 *
 * @param name Name of the catalog function.
 * @param returnType Declared catalog return type identifier.
 * @param value Resolved runtime value returned by the function.
 * @throws {A2uiExpressionError} When `value` does not match `returnType`.
 */
export function assertFunctionReturnType(
  name: string,
  returnType: A2uiReturnType,
  value: unknown,
): void {
  if (isValidReturnTypeValue(returnType, value)) {
    return;
  }
  const actualType = describeRuntimeType(value);
  throw new A2uiExpressionError(
    `Function '${name}' returned ${actualType}, expected returnType '${returnType}'.`,
    name,
    {expectedReturnType: returnType, actualType},
  );
}

/**
 * Wraps a function's raw return value (synchronous value, `Promise`, or
 * reactive `Signal`) so its resolved value is validated against `returnType`
 * without coercion while preserving subscriptions and cleanup hooks.
 *
 * @param name Name of the catalog function.
 * @param returnType Declared catalog return type identifier.
 * @param result Raw return value from function execution or agent routing.
 * @param abortSignal Optional abort signal for asynchronous evaluations.
 * @returns The validated value, validated Promise, or validated Signal.
 */
export function validateFunctionResult(
  name: string,
  returnType: A2uiReturnType,
  result: unknown,
  abortSignal?: AbortSignal,
): unknown {
  if (!needsReturnTypeValidation(returnType) || result instanceof FailedArgument) {
    return result;
  }
  if (isThenable(result)) {
    return Promise.resolve(result).then(resolved => {
      if (resolved instanceof FailedArgument) {
        return resolved;
      }
      if (abortSignal?.aborted) {
        if (isSignal(resolved)) {
          resolved.unsubscribe?.();
        }
        return undefined;
      }
      return validateFunctionResult(name, returnType, resolved, abortSignal);
    });
  }
  if (isSignal(result)) {
    return wrapValidatedSignal(name, returnType, result);
  }
  assertFunctionReturnType(name, returnType, result);
  return result;
}

function wrapValidatedSignal(
  name: string,
  returnType: A2uiReturnType,
  source: Signal<unknown>,
): Signal<unknown> {
  const prevUnsubscribe = source.unsubscribe?.bind(source);
  const validated = computed(() => {
    const val = getValue(source);
    if (val instanceof FailedArgument) {
      return val;
    }
    assertFunctionReturnType(name, returnType, val);
    return val;
  });
  if (prevUnsubscribe) {
    validated.unsubscribe = () => {
      prevUnsubscribe();
    };
  }
  return validated;
}
