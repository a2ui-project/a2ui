/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Injectable} from '@angular/core';
import {z} from 'zod';
import {BasicCatalogBase, BASIC_FUNCTIONS} from '@a2ui/angular/v0_9';
import {customSliderComponentDeclaration} from './custom-slider.component';
import {createFunctionImplementation, FunctionImplementation} from '@a2ui/web_core/v0_9';

/**
 * A catalog specific to the demo, extending the basic catalog with custom components.
 */
@Injectable({
  providedIn: 'root',
})
export class DemoCatalog extends BasicCatalogBase {
  constructor() {
    const capitalizeImplementation: FunctionImplementation = createFunctionImplementation(
      {
        name: 'capitalize',
        returnType: 'string',
        schema: z.object({value: z.string().optional()}) as any,
      },
      args => {
        const value = String(args.value || '');
        return value.charAt(0).toUpperCase() + value.slice(1);
      },
    );

    // Unify functions from both core and angular libraries, plus local demo functions
    const functions = [...BASIC_FUNCTIONS, capitalizeImplementation];

    super({
      id: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      components: {},
      extraComponents: [customSliderComponentDeclaration],
      functions,
    });
  }
}
