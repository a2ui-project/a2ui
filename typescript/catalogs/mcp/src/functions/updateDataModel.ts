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
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

import {resolveDynamicValueDeep} from '../dynamic-values.js';
import {asyncable, withSettledArgs} from './common.js';

/** Function API definition for `updateDataModel`. */
export const UpdateDataModelApi = {
  name: 'updateDataModel',
  returnType: 'any',
  schema: z.object({
    updates: asyncable(z.any()).describe(
      'An object mapping data model paths to the values to write (e.g., {"/entries": [...], "/title": "Home"}). Paths starting with "/" are absolute; relative paths resolve against the current data context.',
    ),
  }),
} as const;

/**
 * Writes multiple path-value pairs to the surface data model.
 *
 * Ignores `null` or `undefined` updates without throwing an error.
 *
 * @throws A2uiExpressionError if `updates` is not a plain object, `null`, or `undefined`.
 */
export const UpdateDataModelImplementation: FunctionImplementation = createFunctionImplementation(
  UpdateDataModelApi,
  (args, context) => {
    const requested = resolveDynamicValueDeep<unknown>(args['updates'], context);
    return withSettledArgs({updates: requested}, settled => {
      const updates = settled['updates'];
      if (updates === null || updates === undefined) {
        return;
      }
      if (typeof updates !== 'object' || Array.isArray(updates)) {
        const kind = Array.isArray(updates) ? 'an array' : `a ${typeof updates}`;
        throw new A2uiExpressionError(
          `updateDataModel expects an object of data model paths, got ${kind}.`,
          'updateDataModel',
        );
      }
      for (const [path, value] of Object.entries(updates as Record<string, unknown>)) {
        // Clone objects and arrays to prevent mutations from affecting cached tool results.
        context.set(
          path,
          typeof value === 'object' && value !== null ? structuredClone(value) : value,
        );
      }
    });
  },
);
