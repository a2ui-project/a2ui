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

import type {Catalog, FunctionImplementation, JsonSchemaValidator} from '@a2ui/web_core';
import {
  createBasicCatalog as createWebCoreBasicCatalog,
  createBasicCatalogFunctions,
} from '@a2ui/web_core/v0_9/basic_catalog';
import type {LitComponentApi} from '../../../types.js';

/** The v0.9 basic catalog for Lit. */
export type LitBasicCatalog = Catalog<LitComponentApi, FunctionImplementation>;

const built = new WeakMap<JsonSchemaValidator, LitBasicCatalog>();

/**
 * Returns the basic catalog for A2UI components in Lit.
 *
 * This catalog includes a wide range of components such as text, button,
 * text field, row, column, list, image, icon, video, audio player, card,
 * divider, checkbox, slider, date-time input, choice picker, tabs, and modal.
 * It also includes the basic functions: the ones the v0.9 specification
 * defines, after the legacy functions of `@a2ui/web_core` 0.9.x (`add`,
 * `equals`, `contains` and the rest).
 *
 * The components and functions validate with `validator`. The catalog is
 * built the first time it is asked for with a validator, and later calls
 * with the same validator return the same catalog.
 *
 * @param validator The JSON Schema validator, such as `createAjvValidator()`
 *   from `@a2ui/validator-ajv`.
 * @throws {A2uiConfigurationError} If `validator` is missing.
 */
export function createBasicCatalog(validator: JsonSchemaValidator): LitBasicCatalog {
  // web_core reports a missing validator.
  const base = createWebCoreBasicCatalog(validator);
  let catalog = built.get(validator);
  if (!catalog) {
    catalog = base.withEntries<LitComponentApi, FunctionImplementation>(
      [...base.components.values()],
      createBasicCatalogFunctions(validator),
    );
    built.set(validator, catalog);
  }
  return catalog;
}
