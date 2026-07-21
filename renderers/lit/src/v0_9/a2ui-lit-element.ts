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
import {ComponentContext, ComponentApi, type ComponentId} from '@a2ui/web_core/v0_9';
import {renderA2uiNode} from './surface/render-a2ui-node.js';
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

    return renderA2uiNode(new ComponentContext(surface, componentId, path), surface.catalog);
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
      if (this.controller) {
        this.removeController(this.controller);
        this.controller.dispose();
      }
      this.controller = this.createController();
    }
  }
}
