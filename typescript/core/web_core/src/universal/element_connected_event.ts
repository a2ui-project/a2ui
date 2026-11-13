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

import type {A2uiWebComponentElement} from './a2ui_web_component_element.js';

/**
 * Name of the event a universal element dispatches the first time it is connected to the DOM with
 * a `node` or `context`. It bubbles and is composed, so host renderers can observe every element of
 * a surface, including the ones universal containers create, from a single ancestor. Listeners
 * outside the element's shadow tree see a retargeted `event.target`, so read the element from
 * `event.composedPath()[0]`.
 *
 * `A2uiLitElement` dispatches it from its own lifecycle, and the renderers dispatch it for the
 * elements they create through `dispatchA2uiElementConnected`.
 */
export const A2UI_ELEMENT_CONNECTED_EVENT = 'a2ui-element-connected';

const connectedElements = new WeakSet<Element>();

/**
 * Dispatches {@link A2UI_ELEMENT_CONNECTED_EVENT} from `element`, at most once per element.
 *
 * It does nothing until `element` is connected and has a `context` (or a `node` with one), and
 * nothing after it has dispatched, so callers can invoke it from every place the element might
 * become ready. Custom containers that create child elements by hand, without `renderA2uiNode`,
 * call it after inserting each child so hosts observe children of any base class.
 */
export function dispatchA2uiElementConnected(element: A2uiWebComponentElement): void {
  if (
    connectedElements.has(element) ||
    !element.isConnected ||
    !(element.context ?? element.node?.context)
  ) {
    return;
  }
  connectedElements.add(element);
  element.dispatchEvent(
    new CustomEvent(A2UI_ELEMENT_CONNECTED_EVENT, {bubbles: true, composed: true}),
  );
}
