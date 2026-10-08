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

import {html, nothing, LitElement, PropertyValues} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {SurfaceModel, ComponentContext, Catalog} from '@a2ui/web_core';
import {renderA2uiNode} from './render-a2ui-node.js';
import type {LitComponentApi} from '../types.js';

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
   * It subscribes to the components model so the surface re-renders whenever
   * the 'root' component is created or deleted.
   *
   * @param changedProperties Map of changed properties.
   */
  protected override willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('surface')) {
      this.subscribeToRoot();
    }
  }

  /**
   * Restores the root subscriptions when the element is reattached.
   */
  override connectedCallback() {
    super.connectedCallback();
    if (this.surface && !this.unsubscribe) {
      this.subscribeToRoot();
    }
  }

  /**
   * Cleans up subscriptions.
   */
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /**
   * Tracks the 'root' component of the current surface for as long as the
   * surface is shown.
   *
   * The processor replaces a component's model when an update changes its
   * type or catalog, deleting the old model and creating a new one, so the
   * subscription outlives the first creation of the root: the surface then
   * renders the new model.
   */
  private subscribeToRoot() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const components = this.surface?.componentsModel;
    this._hasRoot = !!components?.get('root');
    if (!components) return;

    const created = components.onCreated.subscribe(comp => {
      if (comp.id === 'root') {
        this._hasRoot = true;
        this.requestUpdate();
      }
    });
    const deleted = components.onDeleted.subscribe(id => {
      if (id === 'root') {
        this._hasRoot = !!components.get('root');
        this.requestUpdate();
      }
    });
    this.unsubscribe = () => {
      created.unsubscribe();
      deleted.unsubscribe();
    };
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
      return html`<slot name="loading"><div>Loading surface...</div></slot>`;
    }

    try {
      const rootContext = new ComponentContext(this.surface, 'root', '/');
      // The root resolves against its own catalog, so a v1.0 surface without a
      // default catalog still renders.
      const activeCatalog = rootContext.componentModel.catalog as Catalog<LitComponentApi>;
      return renderA2uiNode(rootContext, activeCatalog);
    } catch (e) {
      console.error('Error creating root context:', e);
      return html`<div>Error rendering surface</div>`;
    }
  }
}
