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
  RequiredApi as RequiredV09Api,
  RegexApi as RegexV09Api,
  LengthApi as LengthV09Api,
  NumericApi as NumericV09Api,
  EmailApi as EmailV09Api,
} from '../../v0_9/basic_catalog/functions/basic_functions_api.js';

/**
 * v1.0 required validation function.
 * Return type: 'validationResult'.
 */
export const RequiredV1_0Api = {
  name: 'required' as const,
  returnType: 'validationResult' as const,
  schema: RequiredV09Api.schema,
};

/**
 * v1.0 regex validation function.
 * Return type: 'validationResult'.
 */
export const RegexV1_0Api = {
  name: 'regex' as const,
  returnType: 'validationResult' as const,
  schema: RegexV09Api.schema,
};

/**
 * v1.0 length validation function.
 * Return type: 'validationResult'.
 */
export const LengthV1_0Api = {
  name: 'length' as const,
  returnType: 'validationResult' as const,
  schema: LengthV09Api.schema,
};

/**
 * v1.0 numeric validation function.
 * Return type: 'validationResult'.
 */
export const NumericV1_0Api = {
  name: 'numeric' as const,
  returnType: 'validationResult' as const,
  schema: NumericV09Api.schema,
};

/**
 * v1.0 email validation function.
 * Return type: 'validationResult'.
 */
export const EmailV1_0Api = {
  name: 'email' as const,
  returnType: 'validationResult' as const,
  schema: EmailV09Api.schema,
};

/**
 * v1.0 basic catalog validation APIs.
 */
export const V10_VALIDATION_FUNCTION_APIS = [
  RequiredV1_0Api,
  RegexV1_0Api,
  LengthV1_0Api,
  NumericV1_0Api,
  EmailV1_0Api,
];
