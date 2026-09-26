/*
 * Copyright 2024 Google LLC
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

import {Type} from '@angular/core';
import {Catalog, ComponentApi, FunctionImplementation} from '@a2ui/web_core/v0_9';
import {
  WebComponentImplementation,
  isWebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {z} from 'zod';
import {CatalogComponentInstance} from '../core/catalog_component_instance';
import {toWebComponent} from './to_web_component';
import {UniversalOnlyComponent} from './universal_only.component';

/**
 * Temporary type used during basic catalog schema alignment to bypass strict type checking.
 *
 * To be removed once all properties implemented in Angular basic catalog components conform
 * to the basic catalog schema.
 * @see https://github.com/a2ui-project/a2ui/issues/1303
 */
export type AnyDuringSchemaAlignment = any;

/**
 * Extends the generic {@link ComponentApi} to include Angular-specific component metadata.
 */
export interface AngularComponentImplementation extends ComponentApi {
  /**
   * The Angular component class used to render this component.
   *
   * This class must be an Angular {@link Type} (e.g., a standalone component class)
   * that accepts `props`, `surfaceId`, and `dataContextPath` as inputs.
   */
  readonly component: Type<CatalogComponentInstance>;
}

/**
 * A collection of component and function implementations mapped to
 * A2UI protocol types.
 *
 * Accepts native Angular components (`AngularComponentImplementation`) and
 * universal Web Components (`WebComponentImplementation`). Web Component
 * entries render only when `RendererConfiguration.useUniversalComponents`
 * is enabled.
 *
 * Catalogs are used by the {@link MessageProcessor} to resolve component
 * definitions and by {@link ComponentHostComponent} to instantiate the
 * correct Angular components.
 */
export class AngularCatalog extends Catalog<AngularComponentImplementation> {
  constructor(
    id: string,
    protocolVersion: string,
    components: ReadonlyArray<AngularComponentImplementation | WebComponentImplementation> = [],
    functions?: FunctionImplementation[],
    themeSchema?: z.ZodTypeAny,
    instructions?: string,
  ) {
    super(
      id,
      protocolVersion,
      components.map(toAngularComponentImplementation),
      functions,
      themeSchema,
      instructions,
    );
  }
}

function toAngularComponentImplementation(
  entry: AngularComponentImplementation | WebComponentImplementation,
): AngularComponentImplementation {
  if (!isAngularComponentImplementation(entry)) {
    // Workaround, needed only while 1P apps migrate to `useUniversalComponents: true`: until
    // then every catalog entry must carry an Angular component, so Web Component-only entries
    // get a placeholder that reports the missing flag instead of rendering.
    return {...entry, component: UniversalOnlyComponent};
  }
  return entry;
}

/**
 * Duck-types a catalog entry as an {@link AngularComponentImplementation}
 * (`typeof api.component === 'function'`), so catalogs built from plain object
 * literals are recognized without class inheritance or brand symbols.
 */
function isAngularComponentImplementation(api: unknown): api is AngularComponentImplementation {
  return (
    typeof api === 'object' &&
    api !== null &&
    'component' in api &&
    typeof (api as {component?: unknown}).component === 'function'
  );
}

/**
 * Creates a catalog entry for an Angular component that can be rendered both natively and as a
 * universal Web Component.
 *
 * The entry also carries a Custom Element (`tagName`, `element`): the one of `componentApi` when
 * it is a `WebComponentImplementation` (for example a `@a2ui/web_core` basic catalog component),
 * otherwise `component` wrapped with {@link toWebComponent}. Universal container components can
 * therefore render the entry by tag, and the renderer mounts the element instead of `component`
 * when `RendererConfiguration.useUniversalComponents` is enabled.
 *
 * @param componentApi The ComponentApi or WebComponentImplementation defining the schema and name.
 * @param component The Angular Component class.
 * @returns The entry, usable both natively and as a Web Component.
 */
export function createComponentImplementation(
  componentApi: ComponentApi | WebComponentImplementation,
  component: Type<CatalogComponentInstance>,
): AngularComponentImplementation {
  const webComponent = isWebComponentImplementation(componentApi)
    ? componentApi
    : toWebComponent({name: componentApi.name, schema: componentApi.schema, component});

  // Annotated wider than the return type so the Custom Element fields pass the object literal
  // check; to consumers the entry is an AngularComponentImplementation that also satisfies
  // `isWebComponentImplementation`.
  const implementation: AngularComponentImplementation & WebComponentImplementation = {
    name: componentApi.name,
    schema: componentApi.schema,
    tagName: webComponent.tagName,
    element: webComponent.element,
    component,
  };
  return implementation;
}
