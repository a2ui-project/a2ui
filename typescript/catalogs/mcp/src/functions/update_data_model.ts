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

import {
  A2uiExpressionError,
  DynamicValueSchema,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

/** Function API definition for `updateDataModel`. */
export const UpdateDataModelApi = {
  name: 'updateDataModel' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'updates': DynamicValueSchema.describe(
      'An object mapping data model paths to the values to write (e.g., {"/entries": [...], "/title": "Home"}). Paths starting with "/" are absolute; relative paths resolve against the current data context.',
    ),
  }),
  description: 'Writes key-value pairs to the surface data model.',
};

/**
 * Path segments that would reach the prototype chain instead of the data model. `DataModel`
 * rejects them too; checking here keeps the whole update from being applied partially.
 */
const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Throws if `path` is empty or contains a forbidden segment.
 *
 * @throws A2uiExpressionError naming the offending key.
 */
function validateUpdatePath(path: string): void {
  if (path === '') {
    throw new A2uiExpressionError(
      'updateDataModel rejected an empty key: every key must be a data model path.',
      'updateDataModel',
    );
  }
  for (const segment of path.split('/')) {
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      throw new A2uiExpressionError(
        `updateDataModel rejected the key '${path}': the segment '${segment}' is not allowed.`,
        'updateDataModel',
      );
    }
  }
}

/**
 * Writes each path-value pair of `updates` to the surface data model.
 *
 * Objects and arrays are cloned before they are stored, so later writes through the data model
 * cannot alter a cached tool result. Every key is checked before anything is written, so an
 * invalid key leaves the data model unchanged.
 *
 * @throws A2uiExpressionError if `updates` is a primitive or an array, or if a key is empty or
 *     contains a `__proto__`, `constructor` or `prototype` segment.
 */
export const UpdateDataModelImplementation: FunctionImplementation = createFunctionImplementation(
  UpdateDataModelApi,
  (args, context) => {
    const updates: unknown = args['updates'];
    if (Array.isArray(updates) || typeof updates !== 'object' || updates === null) {
      const kind = Array.isArray(updates) ? 'array' : updates === null ? 'null' : typeof updates;
      throw new A2uiExpressionError(
        `updateDataModel expects an object of data model paths, got ${kind}.`,
        'updateDataModel',
      );
    }
    const entries = Object.entries(updates as Record<string, unknown>);
    for (const [path] of entries) {
      validateUpdatePath(path);
    }
    for (const [path, value] of entries) {
      context.set(
        path,
        typeof value === 'object' && value !== null ? structuredClone(value) : value,
      );
    }
  },
);
