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
import type {A2uiLitElement} from './a2ui-lit-element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';

/** A concrete `A2uiLitElement` class the helper can derive from. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type A2uiLitElementConstructor = new (...args: any[]) => A2uiLitElement<any, any>;

/**
 * Binds an `A2uiLitElement` class to the API of one protocol version.
 *
 * A single element class can serve several protocol versions. Each versioned
 * catalog calls this once per component with its own `api` and `tagName`; the
 * helper derives a subclass whose `api` is fixed to that version, so the same
 * rendering code is registered once per protocol version.
 *
 * ```ts
 * export const A2uiButton = toWebComponentImplementation(
 *   A2uiBasicButtonElement,
 *   ButtonApi,
 *   'a2ui-basic-button-v1',
 * );
 * ```
 *
 * @param base The element class to derive from.
 * @param api The component API the derived element binds to.
 * @param tagName The tag the derived element is registered under.
 * @returns A `WebComponentImplementation` combining `api`, `tagName`, and the
 *     derived element.
 */
export function toWebComponentImplementation<Api extends ComponentApi>(
  base: A2uiLitElementConstructor,
  api: Api,
  tagName: string,
): WebComponentImplementation<Api['schema']> {
  const element = class extends base {
    protected override readonly api = api;
  };
  return {...api, tagName, element};
}
