/*
 * Copyright 2026 Google LLC
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

import {ComponentApi, Catalog} from './types.js';

export interface PortableComponentAdapterOptions {
  tagName: string;
}

/**
 * Creates a generic catalog adapter mapping a component API to a Web Component custom element tag name.
 */
export function createComponentAdapter<T extends ComponentApi>(
  api: T,
  tagName: string,
): T & PortableComponentAdapterOptions {
  return {
    ...api,
    tagName,
  };
}

/**
 * Helper to register Angular catalog adapters for A2UI Portable Web Components.
 */
export function createAngularAdapter<T extends ComponentApi>(
  catalog: Catalog<T>,
  tagMap: Record<string, string> = {},
): Catalog<T & PortableComponentAdapterOptions> {
  const adaptedComponents: (T & PortableComponentAdapterOptions)[] = [];
  for (const [name, comp] of catalog.components.entries()) {
    const tagName = tagMap[name] || `a2ui-${name.toLowerCase()}`;
    adaptedComponents.push(createComponentAdapter(comp, tagName));
  }
  return new Catalog<T & PortableComponentAdapterOptions>(
    `${catalog.id}/angular-adapter`,
    adaptedComponents,
    Array.from(catalog.functions.values()),
    catalog.themeSchema,
  );
}

/**
 * Helper to register React catalog adapters for A2UI Portable Web Components.
 */
export function createReactAdapter<T extends ComponentApi>(
  catalog: Catalog<T>,
  tagMap: Record<string, string> = {},
): Catalog<T & PortableComponentAdapterOptions> {
  const adaptedComponents: (T & PortableComponentAdapterOptions)[] = [];
  for (const [name, comp] of catalog.components.entries()) {
    const tagName = tagMap[name] || `a2ui-${name.toLowerCase()}`;
    adaptedComponents.push(createComponentAdapter(comp, tagName));
  }
  return new Catalog<T & PortableComponentAdapterOptions>(
    `${catalog.id}/react-adapter`,
    adaptedComponents,
    Array.from(catalog.functions.values()),
    catalog.themeSchema,
  );
}
