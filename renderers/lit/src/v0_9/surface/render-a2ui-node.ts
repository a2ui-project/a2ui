/*
 * Copyright 2025 Google LLC
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

import {html, unsafeStatic} from 'lit/static-html.js';
import {ComponentContext, Catalog, SurfaceModel} from '@a2ui/web_core/v0_9';
import {LitComponentApi} from '../types.js';
import {A2uiLitFallbacks, renderFallback} from '../context/fallbacks.js';

/**
 * Tracks the unknown component types already warned/dispatched per surface, so a
 * missing implementation is reported exactly once per type per surface. Keyed on
 * the SurfaceModel (reachable from the pure function via
 * `context.dataContext.surface`) so the Set's lifetime is bounded to the surface.
 */
const warnedBySurface = new WeakMap<SurfaceModel<any>, Set<string>>();

/**
 * Pure function that acts as a generic container for A2UI components.
 *
 * It dynamically resolves and renders the specific Lit component implementation
 * based on the component type provided in the context, returning a TemplateResult directly
 * to avoid duplicate DOM node wrapping.
 *
 * @param context The component context defining the data model and type to render.
 * @param catalog The catalog of component implementations.
 * @param fallbacks Optional consumer-provided fallbacks. When the component
 *   `type` has no catalog implementation, the `unknownComponent` fallback is
 *   rendered (defaulting to `nothing`).
 * @param parentComponentType The `type` of the instantiating parent, threaded in
 *   by the base element (the pure function cannot see the parent). Populated on
 *   the `unknownComponent` fallback info to match the React renderer; absent at
 *   the surface root.
 * @returns A Lit TemplateResult representing the resolved component, the consumer
 *   `unknownComponent` fallback, or `nothing` if the component is unresolvable.
 *
 * This method should be used directly very rarely. Instead, programmers should use
 * the `renderNode` method on the base `A2uiLitElement` class, which handles context
 * creation automatically.
 */
export function renderA2uiNode(
  context: ComponentContext,
  catalog: Catalog<LitComponentApi>,
  fallbacks?: A2uiLitFallbacks,
  parentComponentType?: string,
) {
  const type = context.componentModel.type;
  const implementation = catalog.components.get(type);

  if (!implementation) {
    // Defer the warn + dispatch out of the render phase. Lit has no post-commit
    // hook, so a microtask is the idiomatic equivalent of React's `useEffect`.
    // Dedup once-per-type-per-surface: the re-check runs INSIDE the microtask so
    // multiple synchronous renders of the same unknown type report only once.
    const surface = context.dataContext.surface;
    const componentId = context.componentModel.id;
    queueMicrotask(() => {
      let warned = warnedBySurface.get(surface);
      if (!warned) {
        warned = new Set();
        warnedBySurface.set(surface, warned);
      }
      if (warned.has(type)) return;
      warned.add(type);
      console.warn(`Component implementation not found for type: ${type}`);
      void surface.dispatchError({
        code: 'COMPONENT_NOT_FOUND',
        message: `Component implementation not found for type: ${type}`,
        componentId,
        componentType: type,
      });
    });
    return renderFallback(fallbacks?.unknownComponent, {
      state: 'unknownComponent',
      componentId,
      componentType: type,
      ...(parentComponentType ? {parentComponentType} : {}),
    });
  }

  // Security: only the catalog-resolved (trusted) tagName reaches `unsafeStatic`.
  // The model-controlled `type` flows solely into the warn text and dispatch
  // payload above (data), never into a template sink.
  const tag = unsafeStatic(implementation.tagName);
  return html`<${tag} .context=${context}></${tag}>`;
}
