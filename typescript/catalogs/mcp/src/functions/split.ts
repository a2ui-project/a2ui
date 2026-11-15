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
import {mapTextValue} from './regex_support.js';

/**
 * Splits a string on a literal separator, or each element of an array of strings, giving an
 * array of arrays. An empty separator splits into Unicode code points, so an emoji or other
 * character outside the Basic Multilingual Plane stays whole instead of becoming two surrogate
 * halves.
 *
 * Builds the `split` function of the MCP catalog, with `validator` checking its
 * arguments against the catalog document. Memoised per validator.
 */
export const createSplitImplementation: (validator: JsonSchemaValidator) => FunctionImplementation =
  memoizeByValidator(validator =>
    createFunctionImplementation(mcpFunctionApi(validator, 'split'), args => {
      const separator = String(args['separator']);
      return mapTextValue(args['value'], item =>
        separator === '' ? Array.from(item) : item.split(separator),
      );
    }),
  );
