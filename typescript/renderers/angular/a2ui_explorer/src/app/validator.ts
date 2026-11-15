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

import {provideA2uiValidator} from '@a2ui/angular';
import {createAjvValidator} from '@a2ui/validator-ajv';

/** The JSON Schema validator the explorer's renderers and catalogs validate with. */
export const validator = createAjvValidator();

/** Provides {@link validator} as `A2UI_JSON_SCHEMA_VALIDATOR`. */
export function provideExplorerValidator() {
  return provideA2uiValidator(validator);
}
