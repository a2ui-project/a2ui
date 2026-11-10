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

import type {ComponentApi} from '../catalog/types.js';
import type {WebComponentImplementation} from './web_component_implementation.js';

/**
 * A Custom Element class that declares its own tag name.
 */
export type TaggedCustomElementConstructor = CustomElementConstructor & {
  /** The HTML tag name to register this element under. */
  readonly tagName: string;
};

/**
 * Pairs a Custom Element with the API of one protocol version.
 *
 * A single element class can serve several protocol versions. Each versioned
 * catalog calls this once per component with its own `api`, so the same
 * element and tag name are shared while the schema follows the catalog.
 *
 * ```ts
 * export const A2uiButton = toWebComponentImplementation(A2uiBasicButtonElement, ButtonApi);
 * ```
 *
 * @param element The element class. Its static `tagName` becomes the
 *     implementation's tag name.
 * @param api The component API whose name and schema the implementation uses.
 * @returns A `WebComponentImplementation` combining `api`, `element`, and
 *     `element.tagName`.
 */
export function toWebComponentImplementation<Api extends ComponentApi>(
  element: TaggedCustomElementConstructor,
  api: Api,
): WebComponentImplementation<Api['schema']> {
  return {...api, tagName: element.tagName, element};
}
