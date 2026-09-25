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

import {createFunctionImplementation} from '../../catalog/types.js';
import {
  RequiredV1Point0Api,
  RegexV1Point0Api,
  LengthV1Point0Api,
  NumericV1Point0Api,
  EmailV1Point0Api,
} from './validation_functions_api.js';
import {
  validateRequired,
  validateRegex,
  validateLength,
  validateNumeric,
  validateEmail,
} from '../../common/basic_functions.js';

/**
 * Validates that a value is present and non-empty for v1.0 catalogs.
 *
 * Returns a validation result object with an error message if invalid.
 */
export const RequiredV1Point0Implementation = createFunctionImplementation(
  RequiredV1Point0Api,
  args => validateRequired(args.value),
);

/**
 * Validates that a string matches a regular expression pattern for v1.0 catalogs.
 *
 * @throws {A2uiExpressionError} If the pattern is invalid.
 */
export const RegexV1Point0Implementation = createFunctionImplementation(RegexV1Point0Api, args =>
  validateRegex(args.value, args.pattern),
);

/**
 * Validates that string or array length falls within an optional range for v1.0 catalogs.
 */
export const LengthV1Point0Implementation = createFunctionImplementation(LengthV1Point0Api, args =>
  validateLength(args.value, args.min, args.max),
);

/**
 * Validates that a numeric value falls within an optional range for v1.0 catalogs.
 */
export const NumericV1Point0Implementation = createFunctionImplementation(
  NumericV1Point0Api,
  args => validateNumeric(args.value, args.min, args.max),
);

/**
 * Validates that a string matches basic email address syntax for v1.0 catalogs.
 */
export const EmailV1Point0Implementation = createFunctionImplementation(EmailV1Point0Api, args =>
  validateEmail(args.value),
);

/** Standard validation function implementations for v1.0 catalogs. */
export const V10_VALIDATION_FUNCTION_IMPLEMENTATIONS = [
  RequiredV1Point0Implementation,
  RegexV1Point0Implementation,
  LengthV1Point0Implementation,
  NumericV1Point0Implementation,
  EmailV1Point0Implementation,
];
