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
import {ComponentContext, Catalog, WebComponentImplementation} from '@a2ui/web_core/v0_9';

/**
 * Pure function that acts as a generic container for A2UI components in Lit.
 *
 * @param context The component context defining the data model and type to render.
 * @param catalog The catalog of component implementations.
 * @returns A Lit TemplateResult representing the resolved component, or `nothing`.
 */
export function renderA2uiNode(context: ComponentContext, catalog: Catalog<any>) {
  const type = context.componentModel.type;
  const implementation = catalog.components.get(type);

  if (!implementation) {
    console.warn(`Component implementation not found for type: ${type}`);
    return nothing;
  }

  const tagName = (implementation as WebComponentImplementation).tagName;
  if (tagName) {
    const tag = unsafeStatic(tagName);
    return html`<${tag} .context=${context}></${tag}>`;
  }
  return nothing;
}
