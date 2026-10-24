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
} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

import {withSettledArgs} from './settle_args.js';

/**
 * Function API definition for `parseJson`.
 *
 * The `value` is `z.unknown()` rather than a string schema because it may arrive as the pending
 * Promise of a nested asynchronous call; the type is checked once it has settled.
 */
export const ParseJsonApi = {
  name: 'parseJson' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'value': z
      .unknown()
      .describe('The JSON text to parse, such as the text block of an MCP tool result.'),
  }),
  description: 'Parses a JSON string into the value it encodes.',
};

/**
 * Parses a JSON string, typically the `content[0].text` of a tool result, into the value it
 * encodes.
 *
 * @throws A2uiExpressionError if `value` is not a string or is not valid JSON.
 */
export const ParseJsonImplementation: FunctionImplementation = createFunctionImplementation(
  ParseJsonApi,
  args =>
    withSettledArgs(args, settled => {
      const value = settled['value'];
      if (typeof value !== 'string') {
        const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        throw new A2uiExpressionError(`parseJson expects a string, got ${kind}.`, 'parseJson');
      }
      try {
        return JSON.parse(value);
      } catch (error) {
        throw new A2uiExpressionError(
          `parseJson could not parse the value: ${error instanceof Error ? error.message : String(error)}`,
          'parseJson',
          error,
        );
      }
    }),
);
