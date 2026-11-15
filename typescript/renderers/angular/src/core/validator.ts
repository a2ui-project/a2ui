/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  EnvironmentProviders,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import {noValidatorError, type JsonSchemaValidator} from '@a2ui/web_core';

/**
 * Injection token for the JSON Schema validator that A2UI validates messages, components and
 * function arguments with, such as `createAjvValidator()` from `@a2ui/validator-ajv`.
 *
 * `A2uiRendererService`, the basic catalogs and the v0.8 `MessageProcessor` inject it. There is
 * no default: provide one with {@link provideA2uiValidator}.
 */
export const A2UI_JSON_SCHEMA_VALIDATOR = new InjectionToken<JsonSchemaValidator>(
  'A2UI_JSON_SCHEMA_VALIDATOR',
);

/**
 * Provides the JSON Schema validator that A2UI uses.
 *
 * @example
 * import {createAjvValidator} from '@a2ui/validator-ajv';
 *
 * bootstrapApplication(App, {
 *   providers: [provideA2uiValidator(createAjvValidator()), provideA2UI({...})],
 * });
 *
 * @param validator The validator, such as `createAjvValidator()` from `@a2ui/validator-ajv`.
 * @returns The providers for {@link A2UI_JSON_SCHEMA_VALIDATOR}.
 */
export function provideA2uiValidator(validator: JsonSchemaValidator): EnvironmentProviders {
  return makeEnvironmentProviders([{provide: A2UI_JSON_SCHEMA_VALIDATOR, useValue: validator}]);
}

/** The hint of the error raised when no validator is provided. */
export const PROVIDE_VALIDATOR_HINT =
  'Provide one with provideA2uiValidator(validator) (the A2UI_JSON_SCHEMA_VALIDATOR token), ' +
  'for example provideA2uiValidator(createAjvValidator()) with @a2ui/validator-ajv.';

/**
 * Injects {@link A2UI_JSON_SCHEMA_VALIDATOR}.
 *
 * Must be called in an injection context.
 *
 * @throws {A2uiConfigurationError} If no validator is provided.
 */
export function injectA2uiValidator(): JsonSchemaValidator {
  const validator = inject(A2UI_JSON_SCHEMA_VALIDATOR, {optional: true});
  if (!validator) {
    throw noValidatorError(PROVIDE_VALIDATOR_HINT);
  }
  return validator;
}
