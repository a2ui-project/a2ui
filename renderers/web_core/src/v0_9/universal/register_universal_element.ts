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

import type {WebComponentImplementation} from './web_component_implementation.js';

/**
 * Registers a Web Component's custom element in the browser's `customElements` registry.
 *
 * This operation is idempotent: if the custom element is already registered with the
 * identical constructor, this function safely no-ops. If a different constructor is
 * already registered for the same tag name, this function throws an error.
 *
 * @param component The WebComponentImplementation defining the custom element.
 */
export function registerUniversalElement(component: WebComponentImplementation): void {
  if (typeof customElements === 'undefined') {
    return;
  }

  const existing = customElements.get(component.tagName);
  if (!existing) {
    customElements.define(component.tagName, component.element);
    return;
  }

  if (existing !== component.element) {
    throw new Error(
      `Custom element tag name collision for "${component.tagName}": ` +
        `attempted to register ${component.element.name || 'anonymous constructor'}, ` +
        `but tag name is already registered with ${existing.name || 'another constructor'}.`,
    );
  }
}
