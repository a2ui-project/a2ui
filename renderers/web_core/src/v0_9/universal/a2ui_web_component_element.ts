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

import type {ComponentContext} from '../rendering/component-context.js';

/**
 * The DOM contract an A2UI Custom Element fulfills.
 *
 * A host renderer creates the element for a `WebComponentImplementation` and
 * assigns `context`; the element binds itself from there. Renderers use this
 * type to set the property on an element they have only as an `HTMLElement`.
 */
export interface A2uiWebComponentElement extends HTMLElement {
  context?: ComponentContext;
}
