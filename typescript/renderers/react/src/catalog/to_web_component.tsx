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

import type {ZodTypeAny} from 'zod';
import {
  isWebComponentImplementation,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import type {ReactComponentImplementation} from '../react_component_implementation';
import {ReactWcHost} from './react_host_element';

const hosted = new WeakMap<ReactComponentImplementation, WebComponentImplementation>();
const tagNameCounts = new Map<string, number>();

/**
 * `a2ui-react-<name>`, with an incrementing suffix (`-2`, ...) when two
 * different implementations share a component name.
 */
function computeTagName(name: string): string {
  const baseTagName = `a2ui-react-${name.toLowerCase()}`;
  const count = (tagNameCounts.get(baseTagName) ?? 0) + 1;
  tagNameCounts.set(baseTagName, count);
  return count === 1 ? baseTagName : `${baseTagName}-${count}`;
}

/**
 * The web component form of a React catalog entry: the entry itself plus the
 * host element it renders inside (`tagName`, `element`), one per entry. An
 * entry that already names an element is returned as is. The element is not
 * defined in `customElements` here; renderers define it with
 * `registerUniversalElement` when they render it.
 */
export function toWebComponent<Schema extends ZodTypeAny = ZodTypeAny>(
  implementation: ReactComponentImplementation<Schema> | WebComponentImplementation<Schema>,
): WebComponentImplementation<Schema> {
  if (isWebComponentImplementation(implementation)) {
    return implementation;
  }

  const cached = hosted.get(implementation);
  if (cached) {
    return cached as WebComponentImplementation<Schema>;
  }

  const entry: WebComponentImplementation<Schema> = {
    ...implementation,
    tagName: computeTagName(implementation.name),
    // `customElements` refuses to define one class under two tag names.
    element: class extends ReactWcHost {},
  };

  hosted.set(implementation, entry);
  return entry;
}
