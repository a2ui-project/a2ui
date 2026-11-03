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

import type {z} from 'zod';

import {effect, getValue, signal, type Signal} from '../reactivity/signals.js';
import type {ComponentNode, NodeProps} from '../resolution/component-node.js';
import type {ResolveA2uiProp} from '../resolution/generic-binder.js';
import {ResolvedBinding} from '../resolution/resolved-binding.js';
import type {AccessibilityAttributesSchema as AccessibilityAttributesSchema0_9} from '../v0_9/schema/common-types.js';
import type {AccessibilityAttributesSchema as AccessibilityAttributesSchema1_0} from '../v1_0/schema/common-types.js';

type ResolvedUnionMember<T> = T extends unknown ? Partial<ResolveA2uiProp<T>> : never;
type UnionKeys<T> = T extends unknown ? keyof T : never;

type SupportedAccessibilityAttributes = z.infer<
  typeof AccessibilityAttributesSchema0_9 | typeof AccessibilityAttributesSchema1_0
>;
type AccessibilityAttributeKey = UnionKeys<SupportedAccessibilityAttributes>;

/** Resolved accessibility attributes inferred across supported protocol versions. */
export type ResolvedAccessibilityAttributes = ResolvedUnionMember<SupportedAccessibilityAttributes>;

// Quoted keys survive minification and enforce completeness across AccessibilityAttributeKey.
const HOST_ACCESSIBILITY_SETTERS: Record<
  AccessibilityAttributeKey,
  (host: HTMLElement, a11y: ResolvedAccessibilityAttributes | undefined) => void
> = {
  // Forwarded to inner semantic controls or container groups by components.
  'label': () => {},
  'description': () => {},
  'live': (host, a11y) => {
    const live = a11y && 'live' in a11y ? a11y.live : undefined;
    setOrRemove(host, 'aria-live', live != null ? String(live) : undefined);
  },
  'hidden': (host, a11y) => {
    const hidden =
      a11y && Object.hasOwn(a11y, 'hidden') ? (a11y as {hidden?: unknown}).hidden : undefined;
    setOrRemove(host, 'aria-hidden', typeof hidden === 'boolean' ? String(hidden) : undefined);
    // aria-hidden alone leaves focusable descendants in the tab order, so a
    // hidden subtree is also made inert.
    const isHidden = hidden === true;
    if (host.inert !== isHidden) {
      host.inert = isHidden;
    }
    host.toggleAttribute('inert', isHidden);
  },
};

const HOST_ACCESSIBILITY_SETTER_LIST = Object.values(HOST_ACCESSIBILITY_SETTERS);

/** Sets host-level `aria-live`, `aria-hidden`, and `inert` attributes on a custom element. */
export function setHostAccessibilityAttributes(
  host: HTMLElement,
  a11y?: ResolvedAccessibilityAttributes,
): void {
  for (const setAttribute of HOST_ACCESSIBILITY_SETTER_LIST) {
    setAttribute(host, a11y);
  }
}

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
 * removes every attribute the binding set, and gives an attribute the
 * component had set back its value.
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

/** Sets or removes an attribute, without touching the DOM when it already has that state. */
function setOrRemove(element: Element, name: string, value: string | undefined): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** The ARIA attributes of one host and of the elements its component marks. */
class HostAccessibility {
  /** Where the label and description went last: the target, or the host. */
  private labelled?: Element;
  /**
   * The value each attribute `apply` set had before, per element, so that
   * removing it gives the component's own value back.
   */
  private readonly originals = new Map<Element, Map<string, string | null>>();
  /** The token `apply` added to the target's `aria-describedby`. */
  private describedBy?: string;
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
      // A role the app gave the host is kept.
      const named = label !== undefined || description !== undefined;
      const keepsRole = this.host.hasAttribute('role') && !this.owns(this.host, 'role');
      this.write(this.host, 'role', named && !keepsRole ? 'group' : undefined);
    }
    this.write(labelled, 'aria-label', label);
    this.write(labelled, 'aria-description', description);

    const showsErrors =
      target !== null &&
      errors !== null &&
      state.isValid === false &&
      Boolean(state.validationErrors?.length);
    if (this.namedErrors && (this.namedErrors !== errors || !showsErrors)) {
      this.releaseErrorsId();
    }
    if (!target) {
      return;
    }
    // As on `A2uiLitElement`, only a target carries the validation state:
    // `aria-invalid` is not supported on a group.
    this.write(target, 'aria-invalid', state.isValid === false ? 'true' : undefined);
    this.describe(target, showsErrors ? this.idOf(errors!, errorsId) : undefined);
  }

  /**
   * Sets an attribute, or with `undefined` gives it back the value it had
   * before this binding first set it. An attribute it never set is left alone.
   */
  private write(element: Element, name: string, value: string | undefined): void {
    let originals = this.originals.get(element);
    if (value === undefined) {
      if (!originals?.has(name)) return;
      setOrRemove(element, name, originals.get(name) ?? undefined);
      originals.delete(name);
      if (originals.size === 0) {
        this.originals.delete(element);
      }
      return;
    }
    if (!originals) {
      originals = new Map();
      this.originals.set(element, originals);
    }
    if (!originals.has(name)) {
      originals.set(name, element.getAttribute(name));
    }
    setOrRemove(element, name, value);
  }

  private owns(element: Element, name: string): boolean {
    return this.originals.get(element)?.has(name) ?? false;
  }

  /**
   * Adds `id` to the target's `aria-describedby`, or with `undefined` removes
   * the token added before, keeping the tokens the component set.
   */
  private describe(target: Element, id: string | undefined): void {
    const tokens = (target.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(token => token !== '' && token !== this.describedBy);
    this.describedBy = id !== undefined && !tokens.includes(id) ? id : undefined;
    if (this.describedBy !== undefined) {
      tokens.push(this.describedBy);
    }
    setOrRemove(target, 'aria-describedby', tokens.length ? tokens.join(' ') : undefined);
  }

  private idOf(errors: Element, errorsId: string): string {
    if (!errors.id) {
      errors.id = errorsId;
      this.namedErrors = errors;
    }
    return errors.id;
  }

  /** Takes back every attribute this binding set on `element`. */
  private clear(element: Element): void {
    for (const name of [...(this.originals.get(element)?.keys() ?? [])]) {
      this.write(element, name, undefined);
    }
    if (element !== this.host) {
      this.describe(element, undefined);
    }
  }

  private releaseErrorsId(): void {
    this.namedErrors?.removeAttribute('id');
    this.namedErrors = undefined;
  }
}
