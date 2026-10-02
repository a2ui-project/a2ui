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

/**
 * Keeps one custom element per child position, so a parent re-render
 * updates the element in place instead of replacing it. The element is
 * recreated only when the tag name changes.
 */
class A2uiElementDirective extends Directive {
  private tagName?: string;
  private element?: A2uiWebComponentElement;

  render(tagName: string, context: ComponentContext, node?: ComponentNode) {
    if (!this.element || this.tagName !== tagName) {
      this.tagName = tagName;
      this.element = document.createElement(tagName) as A2uiWebComponentElement;
    }
    if (node) {
      this.element.node = node;
    }
    this.element.context = context;
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
 * the element the node and its context.
 *
 * @param node The resolved node to render.
 * @returns A Lit directive result rendering the component's custom element,
 * or `nothing` for a placeholder, a disposed node, or an implementation that
 * is not a Web Component.
 */
export function renderA2uiNode(node: ComponentNode): DirectiveResult | typeof nothing;
export function renderA2uiNode(
  source: ComponentContext | ComponentNode,
  catalog?: Catalog<WebComponentImplementation>,
) {
  if (isComponentNode(source)) {
    return renderNode(source);
  }
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

function renderNode(node: ComponentNode) {
  if (node.isPlaceholder || node.disposed || !node.context) {
    return nothing;
  }
  const implementation = node.impl as Partial<WebComponentImplementation> | undefined;
  if (!implementation?.tagName) {
    console.warn(`Component implementation not found or missing tagName for type: ${node.type}`);
    return nothing;
  }
  if (isWebComponentImplementation(implementation)) {
    registerUniversalElement(implementation);
  }
  return a2uiElement(implementation.tagName, node.context, node);
}
