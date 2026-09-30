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

import type {ComponentContext} from '../../resolution/component-context.js';
import type {ComponentNode} from '../../resolution/component-node.js';

/**
 * The DOM contract an A2UI Custom Element fulfills.
 *
 * A host renderer creates the element for a `WebComponentImplementation` and
 * assigns `node` (preferred) or `context`; the element binds itself from
 * there. Renderers use this type to set the properties on an element they
 * have only as an `HTMLElement`.
 */
export interface A2uiWebComponentElement extends HTMLElement {
  /**
   * The A2UI context for the node this element renders.
   *
   * The host renderer assigns it right after creating the element, and may
   * reassign it when the element is reused for a different node. Implementations
   * should treat an assignment as the signal to (re)bind to the data model,
   * props, and event handlers exposed by the context, and must tolerate it being
   * unset while the element is detached or rendered standalone.
   */
  context?: ComponentContext;
  /**
   * The resolved node this element renders.
   *
   * A renderer that resolves its surface through a `NodeResolver` assigns it
   * together with `context` (`node.context`), so elements that only read
   * `context` keep working. When both are set, `node` wins: an element that
   * supports it takes its context and its children from the node.
   */
  node?: ComponentNode;
}
