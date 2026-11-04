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

import {nothing} from 'lit';
import {Directive, directive, type DirectiveResult} from 'lit/directive.js';
import {ComponentContext} from '../resolution/component-context.js';
import {isComponentNode, type ComponentNode} from '../resolution/component-node.js';
import {Catalog} from '../catalog/types.js';
import {isWebComponentImplementation} from './is_web_component_implementation.js';
import {registerUniversalElement} from './register_universal_element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';
import type {A2uiWebComponentElement} from './a2ui_web_component_element.js';
import {fallbackRequestFor} from '../resolution/fallbacks.js';
import {renderFallback} from './fallback_renderer.js';

/**
 * What `renderA2uiNode` needs to render a placeholder's fallback, which the node can't supply
 * itself (it has no `context`): the surface it renders on and the type of the component
 * rendering it (absent for the root).
 */
export interface A2uiFallbackContext {
  surface: object;
  parentComponentType?: string;
}

/**
 * Keeps one custom element per child position, so a parent re-render
 * updates the element in place instead of replacing it. The element is
 * recreated only when the tag name changes.
 */
class A2uiElementDirective extends Directive {
  private tagName?: string;
  private element?: A2uiWebComponentElement;

  render(tagName: string, context?: ComponentContext, node?: ComponentNode) {
    if (!this.element || this.tagName !== tagName) {
      this.tagName = tagName;
      this.element = document.createElement(tagName) as A2uiWebComponentElement;
    }
    this.element.node = node;
    if (!node && context !== undefined) {
      this.element.context = context;
    }
    return this.element;
  }
}

const a2uiElement = directive(A2uiElementDirective);

/**
 * Pure function that acts as a generic container for A2UI components.
 *
 * It dynamically resolves and renders the specific Lit component implementation
 * based on the component type provided in the context, returning a TemplateResult directly
 * to avoid duplicate DOM node wrapping.
 *
 * @param context The component context defining the data model and type to render.
 * @param catalog The catalog of component implementations.
 * @returns A Lit directive result rendering the component's custom element, or `nothing` if the component is invalid or unresolvable.
 */
export function renderA2uiNode(
  context: ComponentContext,
  catalog: Catalog<WebComponentImplementation>,
): DirectiveResult | typeof nothing;
/**
 * Renders a resolved node as its implementation's custom element, handing
 * the element the resolved `ComponentNode`.
 *
 * @param node The node to render.
 * @returns A Lit directive result rendering the component's custom element,
 * or `nothing` for a placeholder, a disposed node, or an implementation that
 * is not a Web Component.
 */
export function renderA2uiNode(node: ComponentNode): DirectiveResult | typeof nothing;
/**
 * Renders a node as its implementation's custom element, or a placeholder
 * (pending, unknown type, cyclic) as what the surface's fallback renderer
 * returns for it (see `registerFallbackRenderer`).
 *
 * @param node The node to render.
 * @param fallbackContext The surface and the type of the component rendering `node`.
 * @returns Something Lit renders, or `nothing` when the node renders nothing.
 */
export function renderA2uiNode(node: ComponentNode, fallbackContext: A2uiFallbackContext): unknown;
export function renderA2uiNode(
  source: ComponentContext | ComponentNode,
  catalogOrContext?: Catalog<WebComponentImplementation> | A2uiFallbackContext,
) {
  if (isComponentNode(source)) {
    return (
      renderA2uiNodeOrNull(source, catalogOrContext as A2uiFallbackContext | undefined) ?? nothing
    );
  }
  const catalog = catalogOrContext as Catalog<WebComponentImplementation> | undefined;
  const type = source.componentModel.type;
  const implementation = catalog?.components.get(type);

  if (!implementation || !implementation.tagName) {
    console.warn(`Component implementation not found or missing tagName for type: ${type}`);
    return nothing;
  }

  // A catalog can also hold entries whose element another framework's adapter
  // already defined; those carry a tag name but no element to register.
  if (
    isWebComponentImplementation(implementation) &&
    typeof customElements !== 'undefined' &&
    !customElements.get(implementation.tagName)
  ) {
    registerUniversalElement(implementation);
  }

  return a2uiElement(implementation.tagName, source);
}

/** A node `renderA2uiNode` renders as an element: resolved, with a context and a tag name. */
type RenderableNode = ComponentNode & {
  context: ComponentContext;
  impl: Partial<WebComponentImplementation> & {tagName: string};
};

/**
 * Whether `renderA2uiNode(node)` renders an element for `node`: it has resolved, is not
 * disposed, has a context, and its implementation is a custom element with a tag name.
 */
export function canRenderA2uiNode(node: ComponentNode): node is RenderableNode {
  return (
    !node.isPlaceholder &&
    !node.disposed &&
    !!node.context &&
    !!(node.impl as Partial<WebComponentImplementation> | undefined)?.tagName
  );
}

/**
 * What `renderA2uiNode(node, fallbackContext)` renders, or `null` when that is nothing. A
 * container that gives each child a slot of its own lays out exactly the children for which
 * this is not `null`, so a fallback gets a slot and a child that renders nothing gets none.
 */
export function renderA2uiNodeOrNull(
  node: ComponentNode,
  fallbackContext?: A2uiFallbackContext,
): unknown {
  if (canRenderA2uiNode(node)) {
    const implementation = node.impl;
    if (isWebComponentImplementation(implementation)) {
      registerUniversalElement(implementation);
    }
    return a2uiElement(implementation.tagName, undefined, node);
  }
  const request = fallbackRequestFor(node, fallbackContext?.parentComponentType);
  if (request) {
    return fallbackContext ? renderFallback(fallbackContext.surface, request) : null;
  }
  if (!node.disposed && node.context) {
    console.warn(`Component implementation not found or missing tagName for type: ${node.type}`);
  }
  return null;
}
