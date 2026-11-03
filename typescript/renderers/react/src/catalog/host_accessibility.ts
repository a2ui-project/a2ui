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
 * How a React host applies its node's `accessibility` attributes. The host
 * sets `aria-live` and `aria-hidden` on itself. `label` and `description`
 * go to the element the implementation passes to `accessibilityRef`; when it
 * passes none, the host labels itself as a `role="group"`.
 */

import {
  type ComponentNode,
  type NodeProps,
  ResolvedBinding,
  type Signal,
  setValue,
  signal,
} from '@a2ui/web_core/v0_9';
import {
  type ResolvedAccessibilityAttributes,
  setHostAccessibilityAttributes,
} from '@a2ui/web_core/v0_9/universal';

const targets = new WeakMap<ComponentNode, Signal<Element | null>>();
const refs = new WeakMap<ComponentNode, (element: Element | null) => void>();

/** The element the node's implementation passed to `accessibilityRef`, or `null`. */
export function accessibilityTargetOf(node: ComponentNode): Signal<Element | null> {
  let target = targets.get(node);
  if (!target) {
    target = signal<Element | null>(null);
    targets.set(node, target);
  }
  return target;
}

/**
 * The `accessibilityRef` the node's implementation receives. There is one per
 * node, so React does not detach and reattach it on every render.
 */
export function accessibilityRefFor(node: ComponentNode): (element: Element | null) => void {
  let ref = refs.get(node);
  if (!ref) {
    const target = accessibilityTargetOf(node);
    ref = element => setValue(target, element);
    refs.set(node, ref);
  }
  return ref;
}

function unwrap(value: unknown): unknown {
  return value instanceof ResolvedBinding ? value.value : value;
}

/** `props.accessibility` of a node, with its bindings unwrapped. */
export function resolvedAccessibility(
  props: NodeProps,
): ResolvedAccessibilityAttributes | undefined {
  const accessibility = unwrap(props['accessibility']);
  if (!accessibility || typeof accessibility !== 'object') {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(accessibility).map(([key, value]) => [key, unwrap(value)]),
  ) as ResolvedAccessibilityAttributes;
}

/** `undefined` for a missing or empty value, which leaves the attribute out. */
function attributeText(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

function setOrRemove(element: Element, name: string, value: string | undefined): void {
  if (value === undefined) {
    element.removeAttribute(name);
  } else {
    element.setAttribute(name, value);
  }
}

/** The accessibility attributes of one host and of the element it labels. */
export class HostAccessibility {
  /** Where the label and description went last: the target, or the host. */
  private labelled?: Element;
  /** Whether `apply` set the host's `role`, so a role the app set is kept. */
  private ownsGroupRole = false;

  constructor(private readonly host: HTMLElement) {}

  /**
   * Sets the attributes for `accessibility`, with `label` and `description`
   * on `target`, or on the host when `target` is `null`, and removes the ones
   * a previous call set that no longer apply.
   */
  apply(accessibility: ResolvedAccessibilityAttributes | undefined, target: Element | null): void {
    setHostAccessibilityAttributes(this.host, accessibility);
    const labelled = target ?? this.host;
    if (this.labelled && this.labelled !== labelled) {
      this.clearLabel(this.labelled);
    }
    this.labelled = labelled;

    const label = attributeText(accessibility?.label);
    const description = attributeText(accessibility?.description);
    if (labelled === this.host) {
      // A generic element's `aria-label` is ignored; a group's is announced.
      if (label === undefined && description === undefined) {
        this.releaseGroupRole();
      } else if (!this.host.hasAttribute('role')) {
        this.host.setAttribute('role', 'group');
        this.ownsGroupRole = true;
      }
    }
    setOrRemove(labelled, 'aria-label', label);
    setOrRemove(labelled, 'aria-description', description);
  }

  private clearLabel(element: Element): void {
    element.removeAttribute('aria-label');
    element.removeAttribute('aria-description');
    if (element === this.host) {
      this.releaseGroupRole();
    }
  }

  private releaseGroupRole(): void {
    if (this.ownsGroupRole && this.host.getAttribute('role') === 'group') {
      this.host.removeAttribute('role');
    }
    this.ownsGroupRole = false;
  }
}
