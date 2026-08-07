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

import {Type, Injector, inject} from '@angular/core';
import type {ZodTypeAny} from 'zod';
import {Catalog, ComponentApi, WebComponentImplementation} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/web_core/v0_9/basic_catalog';
import {toWebComponent} from './to_web_component';

export type {WebComponentImplementation} from '@a2ui/web_core/v0_9';

/**
 * Describes an Angular-specific component implementation.
 *
 * In addition to the standard A2UI ComponentApi, this interface accepts
 * an Angular component class (`component`) which is bridged into a Custom Element.
 */
export interface AngularComponentImplementation<
  Schema extends ZodTypeAny = ZodTypeAny,
> extends ComponentApi<Schema> {
  /**
   * The Angular component class used to render this component.
   */
  readonly component: Type<object>;

  /**
   * The custom element tag name for the web component.
   */
  readonly tagName?: string;
}

/**
 * A collection of component and function implementations mapped to
 * A2UI protocol types.
 *
 * Automatically bridges legacy Angular component declarations (`.component`)
 * into Custom Elements (`WebComponentImplementation`) for universal rendering.
 */
export class AngularCatalog extends Catalog<WebComponentImplementation> {
  constructor(
    id: string = basicCatalog.id,
    components: (AngularComponentImplementation | WebComponentImplementation)[] = Array.from(
      basicCatalog.components.values(),
    ),
    functions = Array.from(basicCatalog.functions.values()),
    injector?: Injector,
  ) {
    const hasAngularComponents = components.some(c => 'component' in c && c.component);
    let inj: Injector | undefined = injector;
    if (hasAngularComponents && !inj) {
      try {
        inj = inject(Injector, {optional: true}) ?? undefined;
      } catch {
        // Not in an injection context
      }
    }

    const webComponents: WebComponentImplementation[] = components.map(comp => {
      if ('component' in comp && comp.component) {
        if (!inj) {
          throw new Error(
            `Cannot bridge Angular component '${comp.name}' without an Injector. ` +
              `Provide an Injector to AngularCatalog constructor or use createComponentImplementation(componentImpl, injector).`,
          );
        }
        return toWebComponent(comp as AngularComponentImplementation, inj);
      }
      return comp as WebComponentImplementation;
    });

    super(id, webComponents, functions);
  }
}

/**
 * Helper function to create a {@link WebComponentImplementation} from an {@link AngularComponentImplementation}.
 *
 * @param componentImpl The AngularComponentImplementation combining the schema and component class.
 * @param injector Angular Injector used to instantiate the component.
 * @returns The structured WebComponentImplementation.
 */
export function createComponentImplementation<Schema extends ZodTypeAny = ZodTypeAny>(
  componentImpl: AngularComponentImplementation<Schema>,
  injector: Injector,
): WebComponentImplementation<Schema> {
  return toWebComponent(componentImpl, injector);
}
