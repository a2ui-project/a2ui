/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {type ComponentApi, JsonComponentApi} from '@a2ui/web_core/catalog';
import type {JsonSchemaValidator} from '@a2ui/web_core/schema-engine';
import type {WebComponentImplementation} from '@a2ui/web_core/universal';

/**
 * Memoises `build` per validator object, like web_core's basic catalog
 * factories, so each validator gets one catalog.
 */
export function memoizeByValidator<T>(
  build: (validator: JsonSchemaValidator) => T,
): (validator: JsonSchemaValidator) => T {
  const built = new WeakMap<object, T>();
  return validator => {
    if ((typeof validator !== 'object' && typeof validator !== 'function') || validator === null) {
      return build(validator);
    }
    let value = built.get(validator);
    if (value === undefined) {
      value = build(validator);
      built.set(validator, value);
    }
    return value;
  };
}

/** A custom element class with its tag name. */
interface TaggedElement extends CustomElementConstructor {
  readonly tagName: string;
}

/**
 * Returns the Web Component implementation of a component `Catalog.fromJson`
 * loaded: the same entry, with `element` and its `tagName`.
 *
 * It stays a `JsonComponentApi` (an object spread would not), so
 * `Catalog.toJson` writes the component as its catalog document does.
 *
 * @param api The loaded component.
 * @param element The custom element that renders it.
 * @param defs The `$defs` of the catalog document it was loaded from.
 */
export function implementLoadedComponent<Api extends ComponentApi>(
  api: Api,
  element: TaggedElement,
  defs: Readonly<Record<string, unknown>> | undefined,
): WebComponentImplementation<Api['schema']> {
  if (!(api instanceof JsonComponentApi)) {
    throw new Error(`Component '${api.name}' was not loaded from a catalog document.`);
  }
  class LoadedWebComponent extends JsonComponentApi {
    get tagName(): string {
      return element.tagName;
    }
    get element(): CustomElementConstructor {
      return element;
    }
  }
  const loaded = api;
  return new LoadedWebComponent(
    loaded.name,
    loaded.jsonSchema,
    () => loaded.schema,
    defs,
  ) as unknown as WebComponentImplementation<Api['schema']>;
}
