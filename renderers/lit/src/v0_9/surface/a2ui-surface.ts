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

import {html, nothing, LitElement, PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {provide} from '@lit/context';
import {SurfaceModel, ComponentContext} from '@a2ui/web_core/v0_9';
import {renderA2uiNode} from './render-a2ui-node.js';
import {Context} from '../context/context.js';
import {A2uiLitFallbacks} from '../context/fallbacks.js';
import {LitComponentApi} from '../types.js';

/**
 * A Lit component that renders an A2UI Surface.
 *
 * This component takes a `SurfaceModel` and dynamically renders the root component
 * and its children using the provided catalog. It handles loading states if the
 * root component is not yet available.
 *
 * @element a2ui-surface
 */
@customElement('a2ui-surface')
export class A2uiSurface extends LitElement {
  /**
   * The surface model containing the component tree and catalog.
   */
  @property({type: Object}) accessor surface: SurfaceModel<LitComponentApi> | undefined;

  /**
   * Consumer-provided fallbacks. Provided via `@lit/context` so descendant
   * `A2uiLitElement`s can `@consume` them for nested pending/unknown children.
   * Keep a stable reference. Because this is a reactive property, a new object
   * identity on each render re-renders every pending child.
   */
  @provide({context: Context.fallbacks})
  @property({attribute: false})
  accessor fallbacks: A2uiLitFallbacks | undefined;

  /**
   * Internal state indicating whether the root component exists.
   * @internal
   */
  @state() accessor _hasRoot = false;
  /**
   * Subscription cleanup function.
   * @internal
   */
  private unsubscribe?: () => void;
  /**
   * Guards the root-error dispatch so a persistently failing root reports once
   * PER SURFACE. Keyed on the `SurfaceModel` (mirroring `warnedBySurface` in
   * `render-a2ui-node.ts`) so a per-element boolean cannot stay latched from a
   * prior surface and suppress a second surface's root failure.
   * @internal
   */
  private readonly errorDispatchedBySurface = new WeakMap<SurfaceModel<LitComponentApi>, boolean>();

  /**
   * Handles lifecycle updates, specifically when the `surface` property changes.
   *
   * It manages subscriptions to the components model to detect when the 'root'
   * component is created.
   *
   * @param changedProperties Map of changed properties.
   */
  protected override willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('surface')) {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
      this._hasRoot = !!this.surface?.componentsModel.get('root');

      if (this.surface && !this._hasRoot) {
        const sub = this.surface.componentsModel.onCreated.subscribe(comp => {
          if (comp.id === 'root') {
            this._hasRoot = true;
            this.requestUpdate();
            this.unsubscribe?.();
            this.unsubscribe = undefined;
          }
        });
        this.unsubscribe = () => sub.unsubscribe();
      }
    }
  }

  /**
   * Cleans up subscriptions.
   */
  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Renders the surface.
   *
   * If `surface` is not set, returns `nothing`.
   * If the root component is not yet available, renders a loading state.
   * Otherwise, renders the root component using `renderA2uiNode`.
   */
  override render() {
    if (!this.surface) return nothing;
    if (!this._hasRoot) {
      // Render no visible default text; keep the named slot so a consumer-projected
      // `<div slot="loading">` still renders while the root is pending.
      return html`<slot name="loading"></slot>`;
    }

    try {
      const rootContext = new ComponentContext(this.surface, 'root', '/');
      return html`${renderA2uiNode(rootContext, this.surface.catalog, this.fallbacks)}`;
    } catch (e) {
      console.error('Error creating root context:', e);
      // Report the error state to the agent, deferred out of the render phase and
      // guarded so a persistently failing root does not re-dispatch every render.
      // The visible fallback text is intentionally retained (real-exception path).
      // Capture the surface now: the deferred microtask must key its guard and
      // dispatch on the failing surface, not whatever `this.surface` is later.
      const surface = this.surface;
      queueMicrotask(() => {
        if (!surface || this.errorDispatchedBySurface.get(surface)) return;
        this.errorDispatchedBySurface.set(surface, true);
        void surface.dispatchError({
          code: 'SURFACE_RENDER_ERROR',
          message: 'Error rendering surface',
          componentId: 'root',
          reason: e,
        });
      });
      return html`<div>Error rendering surface</div>`;
    }
  }
}
