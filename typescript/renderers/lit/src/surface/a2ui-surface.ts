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
import {
  NodeResolver,
  effect,
  getValue,
  type ComponentNode,
  type SurfaceModel,
} from '@a2ui/web_core';
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
   * Resolved root component node from `NodeResolver`.
   * @internal
   */
  @state() private accessor _rootNode: ComponentNode<LitComponentApi> | undefined;
  /**
   * Subscription cleanup function.
   * @internal
   */
  private unsubscribe?: () => void;

  /**
   * Renders into the element's direct children (Light DOM) instead of a ShadowRoot
   * so host stylesheets can target components inside the surface.
   */
  override createRenderRoot() {
    return this;
  }

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
    this._rootNode = undefined;
  }

  /**
   * Tracks the 'root' component of the current surface via `NodeResolver` for
   * as long as the surface is shown.
   *
   * The processor replaces a component's model when an update changes its
   * type or catalog, deleting the old model and creating a new one, so the
   * subscription outlives the first creation of the root: the surface then
   * renders the new model.
   */
  private subscribeToRoot() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this._rootNode = undefined;

    if (!this.surface) {
      return;
    }

    const resolver = new NodeResolver(this.surface);
    const stopEffect = effect(() => {
      this._rootNode = getValue(resolver.rootNode);
    });

    this.unsubscribe = () => {
      stopEffect();
      resolver.dispose();
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
    const root = this._rootNode;
    if (!root || root.isPlaceholder) {
      return html`<div>Loading surface...</div>`;
    }

    try {
      return renderA2uiNode(root);
    } catch (e) {
      console.error('Error rendering root node:', e);
      return html`<div>Error rendering surface</div>`;
    }
  }
}
