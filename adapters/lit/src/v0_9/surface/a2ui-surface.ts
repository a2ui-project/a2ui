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
import {SurfaceModel, ComponentContext} from '@a2ui/web_core/v0_9';
import {renderA2uiNode} from './render-a2ui-node.js';
import {LitComponentApi} from '@a2ui/lit/v0_9';

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
   * Handles lifecycle updates, specifically when the `surface` property changes.
   *
   * It manages subscriptions to the components model to detect when the 'root'
   * component is created.
   *
   * @param changedProperties Map of changed properties.
   */
  protected willUpdate(changedProperties: PropertyValues) {
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
  disconnectedCallback() {
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
  render() {
    if (!this.surface) return nothing;
    if (!this._hasRoot) {
      return html`<slot name="loading"><div>Loading surface...</div></slot>`;
    }

    try {
      const rootContext = new ComponentContext(this.surface, 'root', '/');
      return html`${renderA2uiNode(rootContext, this.surface.catalog)}`;
    } catch (e) {
      console.error('Error creating root context:', e);
      return html`<div>Error rendering surface</div>`;
    }
  }
}
