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

/** Function API definition for `updateDataModel`, published in `mcp_catalog.json`. */
export const UpdateDataModelApi = {
  name: 'updateDataModel',
  returnType: 'any',
  schema: z.object({
    updates: asyncable(z.any()).describe(
      'An object whose keys are data model paths and whose values are what to write there, for example {"/entries": [...], "/title": "Home"}. A key starting with "/" is absolute; a relative key resolves against the data context the call was made from, which is the row scope when the call came from a template list.',
    ),
  }),
} as const;

/**
 * Writes an object of data model paths into the surface the call ran on.
 *
 * One call can fill several parts of the model and leave the rest alone, which
 * is what lets a payload turn a single tool result into a screen. Nothing is
 * written when `updates` is null or undefined, so a chain whose earlier step
 * found nothing is not an error.
 *
 * @throws A2uiExpressionError when `updates` is neither an object nor nothing.
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
        // A container is cloned so a later write cannot mutate what the tool
        // result still holds. A primitive has nothing to share.
        context.set(
          path,
          typeof value === 'object' && value !== null ? structuredClone(value) : value,
        );
      }
    });
  },
);
