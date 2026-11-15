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

import {type ComponentApi, createFunctionImplementation} from '@a2ui/web_core/catalog';
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
 * Returns the Web Component implementation of a component `Catalog.fromJson` loaded: a plain
 * object with the component's fields (as an object spread of it has them), `element` and its
 * `tagName`, which keeps the component's definition, so `Catalog.toJson` writes the component as
 * its catalog document does.
 *
 * web_core keeps the definition of a loaded entry beside the entry, and copies it to an
 * implementation built from the entry with `toWebComponentImplementation` or
 * `createFunctionImplementation`. Only the latter is exported, so the implementation is built
 * with it and then given the fields of a component instead of a function's.
 *
 * @param api The loaded component.
 * @param element The custom element that renders it.
 */
export function implementLoadedComponent<Api extends ComponentApi>(
  api: Api,
  element: TaggedElement,
): WebComponentImplementation<Api['schema']> {
  const {name, schema, allowedParents, allowedChildren, metadata} = api;
  const implementation: Record<string, unknown> = createFunctionImplementation(
    api as unknown as Parameters<typeof createFunctionImplementation>[0],
    () => undefined,
  ) as unknown as Record<string, unknown>;
  for (const key of Object.keys(implementation)) {
    delete implementation[key];
  }
  Object.assign(implementation, {
    name,
    schema,
    ...(allowedParents !== undefined ? {allowedParents} : {}),
    ...(allowedChildren !== undefined ? {allowedChildren} : {}),
    ...(metadata !== undefined ? {metadata} : {}),
    tagName: element.tagName,
    element,
  });
  return implementation as unknown as WebComponentImplementation<Api['schema']>;
}
