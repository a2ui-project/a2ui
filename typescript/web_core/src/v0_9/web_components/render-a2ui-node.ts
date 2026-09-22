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

/**
 * Dynamic Lit template renderer for A2UI component nodes.
 */

import {nothing} from 'lit';
import {html, unsafeStatic} from 'lit/static-html.js';
import {ComponentContext} from '../../resolution/component-context.js';
import {Catalog, WebComponentImplementation} from '../../catalog/types.js';

/**
 * Renders a Lit component implementation corresponding to the component type in the context.
 *
 * Dynamically resolves the component's custom element tag name from the catalog and instantiates
 * it with the provided context, returning a `TemplateResult` directly to avoid wrapper DOM nodes.
 *
 * @param context Component context defining the data model and type to render.
 * @param catalog Catalog containing component implementations.
 * @returns A Lit TemplateResult representing the resolved component, or `nothing` if the component is invalid or unresolvable.
 */
export function renderA2uiNode(
  context: ComponentContext,
  catalog: Catalog<WebComponentImplementation>,
) {
  const type = context.componentModel.type;
  const implementation = catalog.components.get(type);

  if (!implementation || !implementation.tagName) {
    console.warn(`Component implementation not found or missing tagName for type: ${type}`);
    return nothing;
  }

  const tag = unsafeStatic(implementation.tagName);
  return html`<${tag} .context=${context}></${tag}>`;
}
