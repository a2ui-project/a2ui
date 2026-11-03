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
 * How a React host applies its node's `accessibility` attributes and
 * validation state. The host sets `aria-live` and `aria-hidden` on itself.
 * `label` and `description` go to the element the implementation passes to
 * `accessibilityRef`; when it passes none, the host labels itself as a
 * `role="group"`. That element also gets `aria-invalid` when a check fails,
 * and `aria-describedby` pointing at the element the implementation passes
 * to `validationErrorsRef` while there are errors to show.
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

type ElementRef = (element: Element | null) => void;

/**
 * The elements a node's implementation hands its host, and the refs it hands
 * them through. There is one set per node, so React does not detach and
 * reattach the refs on every render.
 */
export interface HostRefs {
  /** The element `accessibilityRef` points at, or `null`. */
  readonly target: Signal<Element | null>;
  /** The element `validationErrorsRef` points at, or `null`. */
  readonly errors: Signal<Element | null>;
  readonly accessibilityRef: ElementRef;
  readonly validationErrorsRef: ElementRef;
}

const hostRefs = new WeakMap<ComponentNode, HostRefs>();

export function hostRefsOf(node: ComponentNode): HostRefs {
  let refs = hostRefs.get(node);
  if (!refs) {
    const target = signal<Element | null>(null);
    const errors = signal<Element | null>(null);
    refs = {
      target,
      errors,
      accessibilityRef: element => setValue(target, element),
      validationErrorsRef: element => setValue(errors, element),
    };
    hostRefs.set(node, refs);
  }
  return refs;
}

/** What a host reads from its node's props. */
export interface HostAccessibilityState {
  accessibility?: ResolvedAccessibilityAttributes;
  isValid?: boolean;
  validationErrors?: string[];
}

function unwrap(value: unknown): unknown {
  return value instanceof ResolvedBinding ? value.value : value;
}

/** The accessibility and validation props of a node, with their bindings unwrapped. */
export function hostAccessibilityState(props: NodeProps): HostAccessibilityState {
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

/** The ARIA attributes of one host and of the elements its implementation hands it. */
export class HostAccessibility {
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
    // As on Lit elements, only a target carries the validation state:
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
