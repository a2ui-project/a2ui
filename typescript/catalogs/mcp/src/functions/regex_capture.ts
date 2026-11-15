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

import {createFunctionImplementation, type FunctionImplementation} from '@a2ui/web_core/v1_0';
import {memoizeByValidator} from '@a2ui/web_core/catalog';
import type {JsonSchemaValidator} from '@a2ui/web_core/schema-engine';

import {mcpFunctionApi} from '../document.js';
import {compileSafeRegex, mapTextValue} from './regex_support.js';

/**
 * Matches a string, or each element of an array of strings, against a pattern and returns the
 * capture groups of the first match, or `null` when there is none.
 *
 * @throws A2uiExpressionError if `pattern` is not a valid, safe and portable regular expression.
 *
 * Builds the `regexCapture` function of the MCP catalog, with `validator` checking its
 * arguments against the catalog document. Memoised per validator.
 */
export const createRegexCaptureImplementation: (
  validator: JsonSchemaValidator,
) => FunctionImplementation = memoizeByValidator(validator =>
  createFunctionImplementation(mcpFunctionApi(validator, 'regexCapture'), args => {
    const compiled = compileSafeRegex(String(args['pattern']), 'regexCapture');
    return mapTextValue(args['value'], item => {
      const match = compiled.exec(item);
      return match ? match.slice(1).map(group => group ?? '') : null;
    });
  }),
);
