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
  RequiredApi,
  RegexApi,
  LengthApi,
  NumericApi,
  EmailApi,
} from '../basic_catalog/functions/basic_functions_api.js';

declare module '../../catalog/types.js' {
  interface A2uiReturnTypeMap {
    validationResult: {valid: boolean; message?: string};
  }
}

/**
 * v1.0 required validation function.
 * Return type: 'validationResult'.
 */
export const RequiredV1Point0Api = RequiredApi;

/**
 * v1.0 regex validation function.
 * Return type: 'validationResult'.
 */
export const RegexV1Point0Api = RegexApi;

/**
 * v1.0 length validation function.
 * Return type: 'validationResult'.
 */
export const LengthV1Point0Api = LengthApi;

/**
 * v1.0 numeric validation function.
 * Return type: 'validationResult'.
 */
export const NumericV1Point0Api = NumericApi;

/**
 * v1.0 email validation function.
 * Return type: 'validationResult'.
 */
export const EmailV1Point0Api = EmailApi;

/**
 * v1.0 basic catalog validation APIs.
 */
export const V10_VALIDATION_FUNCTION_APIS = [
  RequiredV1Point0Api,
  RegexV1Point0Api,
  LengthV1Point0Api,
  NumericV1Point0Api,
  EmailV1Point0Api,
];
