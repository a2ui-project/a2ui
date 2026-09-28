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

import type {ComponentContext, ComponentNode} from '@a2ui/web_core/v0_9';
import type {A2uiWebComponentElement} from '@a2ui/web_core/v0_9/universal';
import {HostRegistry} from '../host_registry';
import type {ReactComponentImplementation} from '../react_component_implementation';

/**
 * The custom element that stands in the DOM for a node implemented in React
 * (for example `<a2ui-react-badge>`). It holds no implementation: given its
 * `node`, it registers with its surface's `HostRegistry`, and `A2uiSurface`
 * portals the node's React content into it.
 */
export interface ReactHostElement extends A2uiWebComponentElement {
  node?: ComponentNode<ReactComponentImplementation>;
}

/** The behaviour every host shares; `toWebComponent` derives one subclass per tag name. */
export class ReactWcHost extends HTMLElement implements ReactHostElement {
  context?: ComponentContext;
  private _node?: ComponentNode<ReactComponentImplementation>;
  private registry?: HostRegistry;

  connectedCallback() {
    this.style.display = 'contents';
    this.register();
  }

  disconnectedCallback() {
    // Deferred, so re-parenting (a disconnect and a connect in the same
    // task) keeps the portal and its React state.
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.registry?.delete(this);
        this.registry = undefined;
      }
    });
  }

  set node(node: ComponentNode<ReactComponentImplementation> | undefined) {
    this._node = node;
    this.context = node?.context;
    this.register();
  }

  get node(): ComponentNode<ReactComponentImplementation> | undefined {
    return this._node;
  }

  private register() {
    const node = this._node;
    const surface = node?.context?.dataContext.surface;
    if (!this.isConnected || !node || !surface) return;
    const registry = HostRegistry.forSurface(surface);
    // A node from another surface moves the host to that surface.
    if (this.registry !== registry) {
      this.registry?.delete(this);
      this.registry = registry;
    }
    registry.add(this, node);
  }
}
