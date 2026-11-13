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

import {Injector, Type} from '@angular/core';
import {Catalog, ComponentApi, ComponentContext, FunctionImplementation} from '@a2ui/web_core';
import {WebComponentImplementation, isWebComponentImplementation} from '@a2ui/web_core/universal';
import * as z from 'zod/v4';
import {CatalogComponentInstance} from '../core/catalog_component_instance';
import {componentApiFields, toWebComponent} from './to_web_component';
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

  /**
   * Called once when a universal Web Component rendering this entry first connects to the DOM,
   * with the element, its context, and the injector of the enclosing `ComponentHostComponent`.
   *
   * Lets hosts decorate elements they do not own (for example, to add analytics attributes)
   * without subclassing them. It runs for every universal element the renderers create, whatever
   * its base class, and only universal elements trigger it, so it applies only when
   * `RendererConfiguration.useUniversalComponents` is enabled. A custom container that is not an
   * `A2uiLitElement` and creates child elements by hand reports each child by calling
   * `dispatchA2uiElementConnected` from `@a2ui/web_core/universal` after inserting it.
   */
  readonly onElementConnected?: (
    element: HTMLElement,
    context: ComponentContext,
    injector: Injector,
  ) => void;
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
    components?: ReadonlyArray<AngularComponentImplementation | WebComponentImplementation>,
    functions?: FunctionImplementation[],
    themeSchema?: z.ZodTypeAny,
    instructions?: string,
  );
  /**
   * Initializes a new v0.9 `AngularCatalog` with the pre-1.0 argument order.
   *
   * @deprecated Pass the protocol version as the second argument instead.
   *   Kept so catalogs written against `@a2ui/angular` 0.9.x keep
   *   constructing without a `protocolVersion`.
   */
  constructor(
    id: string,
    components?: ReadonlyArray<AngularComponentImplementation | WebComponentImplementation>,
    functions?: FunctionImplementation[],
    themeSchema?: z.ZodTypeAny,
    instructions?: string,
  );
  constructor(
    id: string,
    protocolVersionOrComponents?:
      | string
      | ReadonlyArray<AngularComponentImplementation | WebComponentImplementation>,
    componentsOrFunctions?:
      | ReadonlyArray<AngularComponentImplementation | WebComponentImplementation>
      | FunctionImplementation[],
    functionsOrThemeSchema?: FunctionImplementation[] | z.ZodTypeAny,
    themeSchemaOrInstructions?: z.ZodTypeAny | string,
    instructions?: string,
  ) {
    if (typeof protocolVersionOrComponents !== 'string') {
      // Pre-1.0 (v0.9) signature: `new AngularCatalog(id, components, functions, ...)`.
      super(
        id,
        '0.9',
        (protocolVersionOrComponents ?? []).map(toAngularComponentImplementation),
        componentsOrFunctions as FunctionImplementation[] | undefined,
        functionsOrThemeSchema as z.ZodTypeAny | undefined,
        themeSchemaOrInstructions as string | undefined,
      );
    } else {
      const components = (componentsOrFunctions ?? []) as ReadonlyArray<
        AngularComponentImplementation | WebComponentImplementation
      >;
      super(
        id,
        protocolVersionOrComponents,
        components.map(toAngularComponentImplementation),
        functionsOrThemeSchema as FunctionImplementation[] | undefined,
        themeSchemaOrInstructions as z.ZodTypeAny | undefined,
        instructions,
      );
    }
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
  if (!isWebComponentImplementation(entry)) {
    // Attach a lazy Web Component wrapper to plain `{...api, component}` entries so universal
    // container elements (`a2ui-basic-column`, `a2ui-card`, etc.) can resolve them by `tagName`
    // via `renderA2uiNode` without requiring callers to wrap with `createComponentImplementation`.
    // The fields are added to the entry itself so callers keep entry identity (for example
    // `catalog.components.get('X') === X_IMPL`); only non-extensible entries are copied.
    const webComponent = toWebComponent(entry);
    const fields = {tagName: webComponent.tagName, element: webComponent.element};
    return Object.isExtensible(entry) ? Object.assign(entry, fields) : {...entry, ...fields};
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
    : toWebComponent({...componentApiFields(componentApi), component});

  // Annotated wider than the return type so the Custom Element fields pass the object literal
  // check; to consumers the entry is an AngularComponentImplementation that also satisfies
  // `isWebComponentImplementation`.
  const implementation: AngularComponentImplementation & WebComponentImplementation = {
    ...componentApiFields(componentApi),
    tagName: webComponent.tagName,
    element: webComponent.element,
    component,
  };
  return implementation;
}
