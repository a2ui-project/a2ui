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

import {html, nothing, type TemplateResult} from 'lit';
import type {z} from 'zod';

import type {ResolveA2uiProp} from '../../../resolution/generic-binder.js';
import type {AccessibilityAttributesSupportedSchemas} from './supported_apis.js';

type ResolvedUnionMember<T> = T extends unknown ? Partial<ResolveA2uiProp<T>> : never;
type UnionKeys<T> = T extends unknown ? keyof T : never;

type SupportedAccessibilityAttributes = z.infer<AccessibilityAttributesSupportedSchemas>;
type AccessibilityAttributeKey = UnionKeys<SupportedAccessibilityAttributes>;

/** Resolved accessibility attributes inferred across supported protocol versions. */
export type ResolvedAccessibilityAttributes = ResolvedUnionMember<SupportedAccessibilityAttributes>;

/** Props that the binder adds to components with validation checks. */
export interface CheckableResolvedProps {
  isValid?: boolean;
  validationErrors?: string[];
}

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
    if (live != null) {
      host.setAttribute('aria-live', String(live));
    } else {
      host.removeAttribute('aria-live');
    }
  },
  'hidden': (host, a11y) => {
    if (a11y && 'hidden' in a11y && typeof a11y.hidden === 'boolean') {
      host.setAttribute('aria-hidden', String(a11y.hidden));
    } else {
      host.removeAttribute('aria-hidden');
    }
  },
};

const HOST_ACCESSIBILITY_SETTER_LIST = Object.values(HOST_ACCESSIBILITY_SETTERS);

/** Sets host-level `aria-live` and `aria-hidden` attributes on a Basic Catalog custom element. */
export function setHostAccessibilityAttributes(
  host: HTMLElement,
  a11y?: ResolvedAccessibilityAttributes,
): void {
  for (const setAttribute of HOST_ACCESSIBILITY_SETTER_LIST) {
    setAttribute(host, a11y);
  }
}

/**
 * Sets group-level `role`, `aria-label`, and `aria-description` directly onto
 * wrapperless layout host elements (`Column` and `Row`) only when explicitly set.
 */
export function setContainerAccessibilityAttributes(
  host: HTMLElement,
  a11y?: ResolvedAccessibilityAttributes,
): void {
  if (hasAttributeValue(a11y?.label)) {
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', String(a11y?.label));
  } else {
    host.removeAttribute('role');
    host.removeAttribute('aria-label');
  }
  if (hasAttributeValue(a11y?.description)) {
    host.setAttribute('aria-description', String(a11y?.description));
  } else {
    host.removeAttribute('aria-description');
  }
}

export function hasAttributeValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function getAccessibilityLabel(
  a11y?: ResolvedAccessibilityAttributes,
): string | typeof nothing {
  return hasAttributeValue(a11y?.label) ? String(a11y?.label) : nothing;
}

export function getAccessibilityDescription(
  a11y?: ResolvedAccessibilityAttributes,
): string | typeof nothing {
  return hasAttributeValue(a11y?.description) ? String(a11y?.description) : nothing;
}

export function hasValidationErrors(props?: CheckableResolvedProps): boolean {
  return props?.isValid === false && Boolean(props.validationErrors?.length);
}

export function getValidationErrorId(
  domId: string,
  props?: CheckableResolvedProps,
): string | typeof nothing {
  return hasValidationErrors(props) ? `${domId}-error` : nothing;
}

export function renderValidationErrors(
  domId: string,
  props?: CheckableResolvedProps,
): TemplateResult | typeof nothing {
  if (hasValidationErrors(props)) {
    return html`
      <div id="${domId}-error" class="a2ui-validation-errors" role="alert">
        ${props!.validationErrors!.map(
          (msg: string) => html`<div class="a2ui-error-message">${msg}</div>`,
        )}
      </div>
    `;
  }
  return nothing;
}
