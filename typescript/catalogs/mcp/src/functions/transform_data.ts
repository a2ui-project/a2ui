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
import type {JsonSchemaValidator} from '@a2ui/web_core/schema-engine';
import {compile, search} from 'jmespath';

import {memoizeByValidator} from '../catalog_support.js';
import {mcpFunctionApi} from '../document.js';

declare module 'jmespath' {
  /** Parses `expression` and throws when it is not valid JMESPath. Exported by the library, not declared by `@types/jmespath`. */
  export function compile(expression: string): unknown;
}

/** Maximum number of validated expressions remembered. */
const MAX_CACHED_EXPRESSIONS = 100;

/** Expressions that `compile` accepted, in insertion order, so repeated bindings parse once. */
const validatedExpressions = new Set<string>();

/** The message of `error`, for an `A2uiExpressionError` that wraps it. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks that `expression` parses as JMESPath, remembering up to `MAX_CACHED_EXPRESSIONS` accepted
 * expressions so a reactive binding that re-evaluates the same string does not parse it twice.
 *
 * @throws A2uiExpressionError if the expression does not parse.
 */
function assertValidExpression(expression: string): void {
  if (validatedExpressions.has(expression)) {
    return;
  }
  try {
    compile(expression);
  } catch (error) {
    throw new A2uiExpressionError(
      `Invalid JMESPath expression: ${expression} (${reason(error)})`,
      'transformData',
      error,
    );
  }
  if (validatedExpressions.size >= MAX_CACHED_EXPRESSIONS) {
    const oldest = validatedExpressions.values().next().value;
    if (oldest !== undefined) {
      validatedExpressions.delete(oldest);
    }
  }
  validatedExpressions.add(expression);
}

/**
 * Evaluates the JMESPath expression in `jmespath` against `data` and returns the result, or `null`
 * when the expression selects nothing.
 *
 * @throws A2uiExpressionError if the expression does not parse, or if evaluating it fails, such as
 *   a function called with an argument of the wrong type.
 *
 * Builds the `transformData` function of the MCP catalog, with `validator` checking its
 * arguments against the catalog document. Memoised per validator.
 */
export const createTransformDataImplementation: (
  validator: JsonSchemaValidator,
) => FunctionImplementation = memoizeByValidator(validator =>
  createFunctionImplementation(mcpFunctionApi(validator, 'transformData'), args => {
    const expression = String(args['jmespath']);
    assertValidExpression(expression);
    try {
      return search(args['data'], expression);
    } catch (error) {
      throw new A2uiExpressionError(
        `JMESPath expression ${expression} failed: ${reason(error)}`,
        'transformData',
        error,
      );
    }
  }),
);
