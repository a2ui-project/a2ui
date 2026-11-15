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
 * The JSON Schema validator the SDK checks messages and catalogs with.
 */

import {type JsonSchemaValidator, noValidatorError} from '../internal/web-core.js';

/**
 * Throws web_core's missing-validator error unless `validator` is a JSON Schema validator.
 *
 * The SDK never picks a validator itself: the application passes one, such as
 * `createAjvValidator()` from `@a2ui/validator-ajv`, wherever messages are checked.
 *
 * @param validator The value given as the validator.
 * @param where What the validator was given to, for the error message.
 * @throws {A2uiConfigurationError} If `validator` has no `compile` method.
 */
export function requireValidator(
  validator: JsonSchemaValidator | undefined,
  where: string,
): asserts validator is JsonSchemaValidator {
  if (typeof validator?.compile !== 'function') {
    throw noValidatorError(
      `Pass one to ${where}, for example createAjvValidator() from @a2ui/validator-ajv.`,
    );
  }
}
