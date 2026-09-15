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

import {createFunctionImplementation, type FunctionImplementation} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

import {TextInput, asyncable, overValue, text, withSettledArgs} from './common.js';

export const SplitApi = {
  name: 'split',
  returnType: 'any',
  schema: z.object({
    value: TextInput.describe(
      'The string to split. An array is split element by element, giving an array of arrays.',
    ),
    separator: asyncable(z.any()).describe(
      'The separator to split on. An empty separator splits into characters.',
    ),
  }),
} as const;

/** Splits a string or each element of an array of strings by `separator`. */
export const SplitImplementation: FunctionImplementation = createFunctionImplementation(
  SplitApi,
  args =>
    withSettledArgs(args, settled => {
      const separator = text(settled['separator']);
      return overValue(settled['value'], item => item.split(separator));
    }),
);
