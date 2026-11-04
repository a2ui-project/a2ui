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

import type {ResolvedAccessibilityAttributes} from '../../host_accessibility.js';

// The host-level setter lives with the host bindings that frameworks share,
// so that they do not depend on the basic catalog.
export {
  type ResolvedAccessibilityAttributes,
  setHostAccessibilityAttributes,
} from '../../host_accessibility.js';

/** Props that the binder adds to components with validation checks. */
export interface CheckableResolvedProps {
  isValid?: boolean;
  validationErrors?: string[];
  validationResults?: Array<{message: string; severity: 'error' | 'warning' | 'info'}>;
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

/**
 * Failed `warning` and `info` check results. A blocking error takes their
 * place, so the control shows one kind of message at a time.
 */
function getValidationHints(props?: CheckableResolvedProps) {
  if (hasValidationErrors(props)) return [];
  return (props?.validationResults ?? []).filter(
    result => result.severity === 'warning' || result.severity === 'info',
  );
}

/** The ID of the rendered error or hint block, for the control's `aria-describedby`. */
export function getValidationMessageId(
  domId: string,
  props?: CheckableResolvedProps,
): string | typeof nothing {
  if (hasValidationErrors(props)) return `${domId}-error`;
  return getValidationHints(props).length > 0 ? `${domId}-hint` : nothing;
}

/** Renders the blocking error messages, or the warning and info hints when there are none. */
export function renderValidationMessages(
  domId: string,
  props?: CheckableResolvedProps,
): TemplateResult | typeof nothing {
  if (hasValidationErrors(props)) {
    return html`
      <div id="${domId}-error" class="a2ui-validation-errors">
        ${props!.validationErrors!.map(
          (msg: string) => html`<div class="a2ui-error-message">${msg}</div>`,
        )}
      </div>
    `;
  }
  const hints = getValidationHints(props);
  if (hints.length === 0) return nothing;
  return html`
    <div id="${domId}-hint" class="a2ui-validation-hints">
      ${hints.map(
        hint =>
          html`<div class="a2ui-hint-message a2ui-hint-${hint.severity}">${hint.message}</div>`,
      )}
    </div>
  `;
}
