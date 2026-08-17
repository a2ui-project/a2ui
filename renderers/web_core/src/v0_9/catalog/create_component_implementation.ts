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

import type {z} from 'zod';
import type {ComponentApi, WebComponentImplementation} from './types.js';

/**
 * Creates a WebComponentImplementation pairing a ComponentApi with a custom element constructor.
 * Resolves the custom element tagName from the registry (via customElements.getName) or defaults to `a2ui-${api.name.toLowerCase()}`.
 *
 * @param api The ComponentApi defining the component name and Zod schema.
 * @param element The CustomElementConstructor implementing the component.
 * @returns A WebComponentImplementation ready to be registered in a Catalog.
 */
export function createComponentImplementation<Schema extends z.ZodTypeAny = z.ZodTypeAny>(
  api: ComponentApi<Schema>,
  element: CustomElementConstructor,
): WebComponentImplementation<Schema> {
  const tagName =
    (typeof customElements !== 'undefined' && 'getName' in customElements
      ? (customElements as any).getName(element)
      : undefined) ?? `a2ui-${api.name.toLowerCase()}`;

  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, element);
  }

  return {
    ...api,
    tagName,
  };
}
