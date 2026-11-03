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
 * How a framework adapter's host element (the custom element a React or
 * Angular component renders inside) applies its node's `accessibility`
 * attributes and validation state.
 *
 * The host sets `aria-live`, `aria-hidden` and `inert` on itself. `label` and
 * `description` go to the target, the element the component marks for them;
 * without one, the host labels itself as a `role="group"`. The target also
 * gets `aria-invalid` while a check fails, and, while there are errors,
 * `aria-describedby` pointing at the element the component marks as showing
 * them.
 */

import {effect, getValue, signal, type Signal} from '../reactivity/signals.js';
import type {ComponentNode, NodeProps} from '../resolution/component-node.js';
import {ResolvedBinding} from '../resolution/resolved-binding.js';
import {
  type ResolvedAccessibilityAttributes,
  setHostAccessibilityAttributes,
} from './basic_catalog/components/accessibility.js';

/** The elements a component marks for its host's accessibility attributes. */
export interface AccessibilityTargets {
  /** The element for the label, description and validation state, or `null`. */
  readonly target: Signal<Element | null>;
  /** The element that shows the validation errors, or `null`. */
  readonly errors: Signal<Element | null>;
}

/** Creates {@link AccessibilityTargets} with no elements marked. */
export function createAccessibilityTargets(): AccessibilityTargets {
  return {target: signal<Element | null>(null), errors: signal<Element | null>(null)};
}

/**
 * Keeps the ARIA attributes of `host`, and of the elements in `targets`, in
 * step with `node` until the returned function is called. That function also
 * removes every attribute the binding set.
 */
export function bindHostAccessibility(
  host: HTMLElement,
  node: ComponentNode,
  targets: AccessibilityTargets,
): () => void {
  const accessibility = new HostAccessibility(host);
  const stop = effect(() => {
    accessibility.apply(
      hostAccessibilityState(getValue(node.props)),
      getValue(targets.target),
      getValue(targets.errors),
      `${node.id}-error`,
    );
  });
  return () => {
    stop();
    accessibility.apply({}, null, null, '');
  };
}

/** What a host reads from its node's props. */
interface HostAccessibilityState {
  accessibility?: ResolvedAccessibilityAttributes;
  isValid?: boolean;
  validationErrors?: string[];
}

function unwrap(value: unknown): unknown {
  return value instanceof ResolvedBinding ? value.value : value;
}

/** The accessibility and validation props of a node, with their bindings unwrapped. */
function hostAccessibilityState(props: NodeProps): HostAccessibilityState {
  const accessibility = unwrap(props['accessibility']);
  const validationErrors = unwrap(props['validationErrors']);
  return {
    accessibility:
      accessibility && typeof accessibility === 'object'
        ? (Object.fromEntries(
            Object.entries(accessibility).map(([key, value]) => [key, unwrap(value)]),
          ) as ResolvedAccessibilityAttributes)
        : undefined,
    isValid: unwrap(props['isValid']) as boolean | undefined,
    validationErrors: Array.isArray(validationErrors) ? validationErrors : undefined,
  };
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

/** The ARIA attributes of one host and of the elements its component marks. */
class HostAccessibility {
  /** Where the label and description went last: the target, or the host. */
  private labelled?: Element;
  /** Whether `apply` set the host's `role`, so a role the app set is kept. */
  private ownsGroupRole = false;
  /** The errors element `apply` gave an `id`, so the `id` can be taken back. */
  private namedErrors?: Element;

  constructor(private readonly host: HTMLElement) {}

  /**
   * Sets the attributes for `state` and removes the ones a previous call set
   * that no longer apply.
   *
   * @param target The element for the label, description and validation
   *     state, or `null` to label the host.
   * @param errors The element showing the validation errors, or `null`.
   * @param errorsId The `id` given to `errors` when it has none.
   */
  apply(
    state: HostAccessibilityState,
    target: Element | null,
    errors: Element | null,
    errorsId: string,
  ): void {
    const {accessibility} = state;
    setHostAccessibilityAttributes(this.host, accessibility);
    const labelled = target ?? this.host;
    if (this.labelled && this.labelled !== labelled) {
      this.clear(this.labelled);
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

    if (this.namedErrors && this.namedErrors !== errors) {
      this.releaseErrorsId();
    }
    if (!target) {
      return;
    }
    // As on `A2uiLitElement`, only a target carries the validation state:
    // `aria-invalid` is not supported on a group.
    setOrRemove(target, 'aria-invalid', state.isValid === false ? 'true' : undefined);
    const showsErrors = state.isValid === false && Boolean(state.validationErrors?.length);
    setOrRemove(
      target,
      'aria-describedby',
      showsErrors && errors ? this.idOf(errors, errorsId) : undefined,
    );
  }

  private idOf(errors: Element, errorsId: string): string {
    if (!errors.id) {
      errors.id = errorsId;
      this.namedErrors = errors;
    }
    return errors.id;
  }

  private clear(element: Element): void {
    element.removeAttribute('aria-label');
    element.removeAttribute('aria-description');
    if (element === this.host) {
      this.releaseGroupRole();
    } else {
      element.removeAttribute('aria-invalid');
      element.removeAttribute('aria-describedby');
    }
  }

  private releaseGroupRole(): void {
    if (this.ownsGroupRole && this.host.getAttribute('role') === 'group') {
      this.host.removeAttribute('role');
    }
    this.ownsGroupRole = false;
  }

  private releaseErrorsId(): void {
    this.namedErrors?.removeAttribute('id');
    this.namedErrors = undefined;
  }
}
