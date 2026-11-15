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

import {EnvironmentProviders, makeEnvironmentProviders} from '@angular/core';
import {A2UI_JSON_SCHEMA_VALIDATOR} from '@a2ui/angular';
import type {JsonSchemaValidator} from '@a2ui/web_core';
import {Catalog, Theme} from './rendering';
import type {Theme as ThemeType} from './types';

/**
 * Provides the v0.8 renderer's catalog, theme and JSON Schema validator.
 *
 * @param config.validator The validator `MessageProcessor` validates messages with, such as
 *   `createAjvValidator()` from `@a2ui/validator-ajv`. It is provided as
 *   `A2UI_JSON_SCHEMA_VALIDATOR`, so it can be left out when `provideA2uiValidator` from
 *   `@a2ui/angular` provides one.
 */
export function provideA2UI(config: {
  catalog: Catalog;
  theme: ThemeType;
  validator?: JsonSchemaValidator;
}): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...(config.validator
      ? [{provide: A2UI_JSON_SCHEMA_VALIDATOR, useValue: config.validator}]
      : []),
    {provide: Catalog, useValue: config.catalog},
    {
      provide: Theme,
      useFactory: () => {
        const theme = new Theme();
        theme.update(config.theme);
        return theme;
      },
    },
  ]);
}
