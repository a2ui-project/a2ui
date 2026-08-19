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
import {A2uiExpressionError} from '../../errors.js';
import {
  RequiredV1_0Api,
  RegexV1_0Api,
  LengthV1_0Api,
  NumericV1_0Api,
  EmailV1_0Api,
} from './validation_functions_api.js';
import {ValidationResultInput as ValidationResult} from '../schema/catalog-definition.js';

/**
 * Implementation of v1.0 required validation function.
 * Returns a ValidationResult object.
 */
export const RequiredV1_0Implementation = createFunctionImplementation(
  RequiredV1_0Api,
  (args): ValidationResult => {
    const val = args.value;
    let isValid = true;
    if (val === null || val === undefined) isValid = false;
    else if (typeof val === 'string' && val === '') isValid = false;
    else if (Array.isArray(val) && val.length === 0) isValid = false;

    return {
      valid: isValid,
      ...(isValid ? {} : {message: 'This field is required.'}),
    };
  },
);

/**
 * Implementation of v1.0 regex validation function.
 * Returns a ValidationResult object.
 */
export const RegexV1_0Implementation = createFunctionImplementation(
  RegexV1_0Api,
  (args): ValidationResult => {
    try {
      const isValid = new RegExp(args.pattern).test(args.value);
      return {
        valid: isValid,
        ...(isValid ? {} : {message: `Value does not match required pattern.`}),
      };
    } catch (e) {
      throw new A2uiExpressionError(`Invalid regex pattern: ${args.pattern}`, 'regex', e);
    }
  },
);

/**
 * Implementation of v1.0 length validation function.
 * Returns a ValidationResult object.
 */
export const LengthV1_0Implementation = createFunctionImplementation(
  LengthV1_0Api,
  (args): ValidationResult => {
    const val = args.value;
    let len = 0;
    if (typeof val === 'string' || Array.isArray(val)) {
      len = val.length;
    }
    let isValid = true;
    let message: string | undefined;

    if (args.min !== undefined && !isNaN(args.min) && len < args.min) {
      isValid = false;
      message = `Minimum length is ${args.min}.`;
    } else if (args.max !== undefined && !isNaN(args.max) && len > args.max) {
      isValid = false;
      message = `Maximum length is ${args.max}.`;
    }

    return {
      valid: isValid,
      ...(message ? {message} : {}),
    };
  },
);

/**
 * Implementation of v1.0 numeric validation function.
 * Returns a ValidationResult object.
 */
export const NumericV1_0Implementation = createFunctionImplementation(
  NumericV1_0Api,
  (args): ValidationResult => {
    if (isNaN(args.value)) {
      return {valid: false, message: 'Value must be a valid number.'};
    }
    let isValid = true;
    let message: string | undefined;

    if (args.min !== undefined && !isNaN(args.min) && args.value < args.min) {
      isValid = false;
      message = `Minimum value is ${args.min}.`;
    } else if (args.max !== undefined && !isNaN(args.max) && args.value > args.max) {
      isValid = false;
      message = `Maximum value is ${args.max}.`;
    }

    return {
      valid: isValid,
      ...(message ? {message} : {}),
    };
  },
);

/**
 * Implementation of v1.0 email validation function.
 * Returns a ValidationResult object.
 */
export const EmailV1_0Implementation = createFunctionImplementation(
  EmailV1_0Api,
  (args): ValidationResult => {
    const isValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(args.value);
    return {
      valid: isValid,
      ...(isValid ? {} : {message: 'Must be a valid email address.'}),
    };
  },
);

export const V10_VALIDATION_FUNCTION_IMPLEMENTATIONS = [
  RequiredV1_0Implementation,
  RegexV1_0Implementation,
  LengthV1_0Implementation,
  NumericV1_0Implementation,
  EmailV1_0Implementation,
];
