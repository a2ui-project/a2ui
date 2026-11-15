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

import type {StandardSchemaV1} from '@standard-schema/spec';

import {unboundJsonSchema} from '../../catalog/catalog-validator.js';
import {createFunctionImplementation, FunctionImplementation} from '../../catalog/types.js';
import {A2uiValidationError} from '../../errors.js';
import {resolveContextIndex} from '../../resolution/data-context.js';

/**
 * The arguments of the `@index` system function, as the v1.0 common types'
 * `IndexSystemFunction` declares them.
 */
export const INDEX_ARGS: Record<string, unknown> = {
  type: 'object',
  properties: {
    offset: {
      $ref: 'common_types.json#/$defs/DynamicNumber',
      description:
        'Optional. An offset to add to the 0-based index (e.g., 1 for 1-based indexing). Defaults to 0.',
      default: 0,
    },
  },
  unevaluatedProperties: false,
};

/**
 * System function definition for computing iteration indices in array contexts.
 *
 * Evaluates the 0-based iteration index with an optional numerical offset.
 */
export const IndexApi = {
  /** Name of the system function. */
  name: '@index' as const,
  /** Declared return type for catalog type checking. */
  returnType: 'number' as const,
  /** Scope of callers permitted to invoke this function. */
  allowedCallers: 'rendererOnly' as const,
  /**
   * The arguments' schema: {@link INDEX_ARGS}, compiled with the validator of
   * the catalog the call runs in. `offset` is a DynamicNumber, so a payload
   * may bind it to a path or a nested call.
   */
  schema: unboundJsonSchema<{offset?: number}>(
    INDEX_ARGS,
    "System function '@index'",
    checkIndexArgs,
  ),
};

/**
 * Checks `@index` arguments as {@link INDEX_ARGS} declares them, for a call
 * with no validator to hand (a surface without a catalog): an object whose
 * only key is `offset`, a number (0 when omitted), or before resolution a
 * data binding or function call.
 */
function checkIndexArgs(value: unknown): StandardSchemaV1.Result<{offset?: number}> {
  const fail = (message: string, path: PropertyKey[] = []) => ({issues: [{message, path}]});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('must be object');
  }
  const args = value as Record<string, unknown>;
  const extra = Object.keys(args).find(key => key !== 'offset');
  if (extra !== undefined) return fail(`unexpected property '${extra}'`, [extra]);
  const offset = args['offset'];
  if (offset === undefined) return {value: {...args, offset: 0}};
  const isCallOrBinding =
    typeof offset === 'object' &&
    offset !== null &&
    (typeof (offset as Record<string, unknown>)['@path'] === 'string' ||
      typeof (offset as Record<string, unknown>)['@call'] === 'string');
  if (typeof offset === 'number' || isCallOrBinding) return {value: args as {offset?: number}};
  return fail('must be number', ['offset']);
}

/**
 * Implementation of the `@index` system function.
 *
 * Returns the 0-based iteration index of the enclosing collection template,
 * plus an optional offset.
 *
 * @throws {A2uiValidationError} If called outside a collection template iteration scope.
 */
export const IndexImplementation = createFunctionImplementation(IndexApi, (args, context) => {
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0;
  const index = resolveContextIndex(context);

  if (index === undefined || !Number.isFinite(index)) {
    throw new A2uiValidationError(
      '@index function can only be evaluated inside a collection template iteration scope.',
    );
  }
  return index + offset;
});

/**
 * Standard v1.0 system function implementations.
 */
export const SYSTEM_FUNCTIONS: FunctionImplementation[] = [IndexImplementation];
