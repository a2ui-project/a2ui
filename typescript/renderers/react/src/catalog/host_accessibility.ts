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

/**
 * The refs a React implementation passes to mark elements for its host's
 * accessibility attributes (see `bindHostAccessibility` in
 * `@a2ui/web_core/v0_9/universal`): `accessibilityRef` for the element that
 * carries the label, description and validation state, and
 * `validationErrorsRef` for the element that shows the validation errors.
 */

import {type ComponentNode, setValue} from '@a2ui/web_core/v0_9';
import {type AccessibilityTargets, createAccessibilityTargets} from '@a2ui/web_core/v0_9/universal';

type ElementRef = (element: Element | null) => void;

/**
 * A node's accessibility targets and the refs that set them. There is one set
 * per node, so React does not detach and reattach the refs on every render.
 */
export interface HostRefs extends AccessibilityTargets {
  readonly accessibilityRef: ElementRef;
  readonly validationErrorsRef: ElementRef;
}

const hostRefs = new WeakMap<ComponentNode, HostRefs>();

export function hostRefsOf(node: ComponentNode): HostRefs {
  let refs = hostRefs.get(node);
  if (!refs) {
    const targets = createAccessibilityTargets();
    refs = {
      ...targets,
      accessibilityRef: element => setValue(targets.target, element),
      validationErrorsRef: element => setValue(targets.errors, element),
    };
    hostRefs.set(node, refs);
  }
  return refs;
}
