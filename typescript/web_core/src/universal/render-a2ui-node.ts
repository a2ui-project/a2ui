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
import {html, unsafeStatic} from 'lit/static-html.js';
import {ComponentContext} from '../resolution/component-context.js';
import {isComponentNode, type ComponentNode} from '../resolution/component-node.js';
import {Catalog} from '../catalog/types.js';
import {isWebComponentImplementation} from './is_web_component_implementation.js';
import {registerUniversalElement} from './register_universal_element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';

/**
 * Pure function that acts as a generic container for A2UI components.
 *
 * It dynamically resolves and renders the specific Lit component implementation
 * based on the component type provided in the context, returning a TemplateResult directly
 * to avoid duplicate DOM node wrapping.
 *
 * @param context The component context defining the data model and type to render.
 * @param catalog The catalog of component implementations.
 * @returns A Lit TemplateResult representing the resolved component, or `nothing` if the component is invalid or unresolvable.
 */
export function renderA2uiNode(
  context: ComponentContext,
  catalog: Catalog<WebComponentImplementation>,
): ReturnType<typeof html> | typeof nothing;
/**
 * Renders a resolved node as its implementation's custom element, handing
 * the element the node and its context.
 *
 * @param node The resolved node to render.
 * @returns A Lit TemplateResult, or `nothing` for a placeholder, a disposed
 * node, or an implementation that is not a Web Component.
 */
export function renderA2uiNode(node: ComponentNode): ReturnType<typeof html> | typeof nothing;
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

  const tag = unsafeStatic(implementation.tagName);
  return html`<${tag} .context=${source}></${tag}>`;
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
  const tag = unsafeStatic(implementation.tagName);
  return html`<${tag} .node=${node} .context=${node.context}></${tag}>`;
}
