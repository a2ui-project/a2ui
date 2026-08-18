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

import {z} from 'zod';
import {createFunctionImplementation, FunctionImplementation} from '../../catalog/types.js';

/**
 * Universal v1.0 system function to calculate the current 0-based iteration index in array contexts.
 *
 * Arguments:
 * - `offset`: Optional numerical offset added to the calculated index.
 */
export const IndexApi = {
  name: '@index' as const,
  returnType: 'number' as const,
  schema: z.object({
    'offset': z.coerce.number().optional(),
  }),
};

/**
 * Implementation of the `@index` function.
 * Returns the loop index offset from context.
 */
export const IndexImplementation = createFunctionImplementation(IndexApi, (args, context) => {
  const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0;
  let index = 0;
  if (typeof (context as any)?.getIndex === 'function') {
    index = (context as any).getIndex();
  } else if (context?.path) {
    const parts = context.path.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(parts[i])) {
        index = parseInt(parts[i], 10);
        break;
      }
    }
  }
  return index + offset;
});

/**
 * Standard v1.0 system function implementations.
 */
export const SYSTEM_FUNCTIONS: FunctionImplementation[] = [IndexImplementation];
