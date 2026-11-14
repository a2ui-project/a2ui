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

/**
 * The validation functions of v1.0 catalogs (`required`, `regex`,
 * `length`, `numeric`, `email`), which return a validation result
 * object. Their schemas come from the catalog document that declares them,
 * such as the v1.0 basic catalog; only their execution is defined here.
 */

import type {FunctionExecutorFactory} from '../../catalog/basic_catalog_factory.js';
import {createFunctionImplementation} from '../../catalog/types.js';
import {
  validateRequired,
  validateRegex,
  validateLength,
  validateNumeric,
  validateEmail,
  type ValidationResult,
} from '../../common/basic_functions.js';

declare module '../../catalog/types.js' {
  interface A2uiReturnTypeMap {
    validationResult: ValidationResult;
  }
}

/**
 * The implementation factory of each v1.0 validation function, by name: each
 * returns a validation result object, with an error message when invalid.
 */
export const V10_VALIDATION_FUNCTION_EXECUTORS: Readonly<Record<string, FunctionExecutorFactory>> =
  {
    required: api => createFunctionImplementation(api, args => validateRequired(args.value)),
    regex: api =>
      createFunctionImplementation(api, args => validateRegex(args.value, args.pattern)),
    length: api =>
      createFunctionImplementation(api, args => validateLength(args.value, args.min, args.max)),
    numeric: api =>
      createFunctionImplementation(api, args => validateNumeric(args.value, args.min, args.max)),
    email: api => createFunctionImplementation(api, args => validateEmail(args.value)),
  };
