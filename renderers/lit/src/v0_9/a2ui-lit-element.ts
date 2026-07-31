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

import {LitElement, nothing} from 'lit';
import {property} from 'lit/decorators.js';
import {consume} from '@lit/context';
import {ComponentContext, ComponentApi, SurfaceModel, type ComponentId} from '@a2ui/web_core/v0_9';
import {renderA2uiNode} from './surface/render-a2ui-node.js';
import {Context} from './context/context.js';
import {A2uiLitFallbacks, renderFallback} from './context/fallbacks.js';
import {A2uiController} from './a2ui-controller.js';

/**
 * A reference to a child component to render. Either a string ID, or an object
 * pairing an ID with an explicit data context path.
 */
type A2uiChildRef = ComponentId | {id: ComponentId; basePath: string};

/**
 * A base class for A2UI Lit elements that manages the A2uiController lifecycle.
 *
 * This element handles the reactive attachment and detachment of the `A2uiController`
 * whenever the component's `context` changes. Subclasses only need to implement
 * `createController` to provide their specific schema-bound controller, and `render`
 * to define the template based on the controller's reactive props.
 *
 * @template Api The specific A2UI component API defining the schema for this element.
 */
export abstract class A2uiLitElement<Api extends ComponentApi> extends LitElement {
  @property({type: Object}) accessor context!: ComponentContext;
  protected controller!: A2uiController<Api>;

  /**
   * Consumer-provided fallbacks, consumed from the surface via `@lit/context`.
   * The element CAN consume; the pure `renderA2uiNode` cannot, which is why the
   * value is threaded into it as a parameter below.
   */
  @consume({context: Context.fallbacks, subscribe: true})
  accessor fallbacks: A2uiLitFallbacks | undefined;

  /**
   * Active onCreated subscriptions for pending child ids, keyed by child id so at
   * most one subscription exists per child despite render-time (re-)detection.
   * The value is the unsubscribe thunk. Cleared in `disconnectedCallback`.
   */
  readonly #childSubs = new Map<ComponentId, () => void>();

  /**
   * Instantiates the unique controller for this element's specific bound API.
   *
   * Subclasses must implement this method to return an `A2uiController` tied to
   * their specific component `Api` definition.
   *
   * @returns A new instance of `A2uiController` matching the component API.
   */
  protected abstract createController(): A2uiController<Api>;

  /**
   * Helper method to render a child A2UI node.
   * Abstracts away the need to manually create a ComponentContext.
   *
   * @param childRef The reference to the child component to render. Either a string ID
   *                 or a reference object containing `{id, basePath}`.
   * @param customPath An explicit data model path to bind the child to. If provided,
   *                   this overrides any path defined in the `childRef` object. If omitted,
   *                   falls back to the `childRef`'s `basePath`, or the current component's path.
   *
   * @returns A Lit template result containing the rendered child component, or `nothing` if the reference is empty.
   */
  protected renderNode(childRef?: A2uiChildRef, customPath?: string) {
    if (!childRef) return nothing;
    const {surface, path: parentPath} = this.context.dataContext;

    // This guard handles cases where a render update is scheduled on a component
    // (e.g., from a click or text input change), but the example is reloaded or
    // the surface is deleted/disposed before the microtask runs. In these cases,
    // the surface components map is cleared, so we return nothing early instead
    // of attempting to resolve child components on a stale or disposed surface.
    const surfaceContainsComponent = !!surface.componentsModel.get(this.context.componentModel.id);
    if (!surfaceContainsComponent) {
      return nothing;
    }

    // Path resolution order: customPath > childRef.basePath > parentPath
    let componentId: ComponentId;
    let path = customPath;
    if (typeof childRef === 'object') {
      componentId = childRef.id;
      path = path ?? childRef.basePath;
    } else {
      componentId = childRef;
    }

    // Keep this fallback because the previous A2uiChildRef type allowed object
    // refs without a basePath.
    path = path ?? parentPath;

    // The parent guard above checks the parent id. This second guard checks the
    // resolved CHILD id: a nested child referenced before it has streamed would
    // make the ComponentContext constructor throw. Pre-empt with a guard (not a
    // try/catch, so a genuine bug still surfaces): render the consumer loading
    // fallback (or nothing) and re-render when the child arrives.
    //
    // Detection is at render time because, unlike the surface (which statically
    // knows 'root'), the base element does not know which children a subclass
    // will render until render runs. The Map guard keeps this leak-free: at most
    // one onCreated subscription exists per pending child id.
    if (!surface.componentsModel.get(componentId)) {
      this.#subscribePendingChild(surface, componentId);
      const parentComponentType = this.context.componentModel.type;
      return renderFallback(this.fallbacks?.loading, {
        state: 'loading',
        componentId,
        ...(parentComponentType ? {parentComponentType} : {}),
      });
    }

    return renderA2uiNode(
      new ComponentContext(surface, componentId, path),
      surface.catalog,
      this.fallbacks,
      this.context.componentModel.type,
    );
  }

  /**
   * Ensures a single targeted onCreated subscription exists for a pending child.
   *
   * Mirrors the surface's subscribe discipline (`a2ui-surface.ts`): filter to the
   * pending child id, `requestUpdate` on arrival, then unsubscribe. The Map guard
   * bounds it to one subscription per child id despite per-render detection.
   */
  #subscribePendingChild(surface: SurfaceModel<any>, componentId: ComponentId) {
    if (this.#childSubs.has(componentId)) return;
    const sub = surface.componentsModel.onCreated.subscribe(comp => {
      if (comp.id !== componentId) return;
      this.requestUpdate();
      this.#childSubs.get(componentId)?.();
      this.#childSubs.delete(componentId);
    });
    this.#childSubs.set(componentId, () => sub.unsubscribe());
  }

  /**
   * Unsubscribes every pending-child subscription and clears the Map.
   *
   * Shared by `disconnectedCallback` and the `context`-change branch of
   * `willUpdate` so a rebind cannot leave subscriptions closed over a stale
   * `SurfaceModel` alive (cross-surface subscription leak).
   */
  #clearChildSubs() {
    for (const unsubscribe of this.#childSubs.values()) {
      unsubscribe();
    }
    this.#childSubs.clear();
  }

  /**
   * Cleans up any outstanding pending-child subscriptions.
   */
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#clearChildSubs();
  }

  /**
   * Reacts to changes in the component's properties.
   *
   * Specifically, when the `context` property changes or is initialized, this method
   * cleans up any existing controller and invokes `createController()` to bind to
   * the new context.
   */
  override willUpdate(changedProperties: Map<string, any>) {
    super.willUpdate(changedProperties);
    if (changedProperties.has('context') && this.context) {
      // Drop subscriptions bound to the previous context/surface BEFORE
      // recreating the controller, so a rebind does not leak stale onCreated
      // subscriptions over the old SurfaceModel.
      this.#clearChildSubs();
      if (this.controller) {
        this.removeController(this.controller);
        this.controller.dispose();
      }
      this.controller = this.createController();
    }
  }
}
