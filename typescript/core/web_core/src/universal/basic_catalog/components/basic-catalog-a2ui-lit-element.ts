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

import {html, nothing} from 'lit';
import {ComponentApi, type InferredComponentApiSchemaType} from '../../../catalog/types.js';
import type {ResolveA2uiProps} from '../../../resolution/generic-binder.js';
import {A2uiLitElement} from '../../index.js';
import {injectBasicCatalogStyles, computeColorVariant} from '../styles/default.js';
import {isValidCssColor} from '../theme.js';

/** Resolved accessibility attributes across supported protocol versions. */
export interface ResolvedAccessibilityAttributes {
  label?: string;
  description?: string;
  live?: 'off' | 'polite' | 'assertive';
  hidden?: boolean;
}

/**
 * The resolved props this base class reads. Not every protocol version
 * defines all of them, so each one is optional.
 */
interface CommonResolvedProps {
  weight?: number;
  accessibility?: ResolvedAccessibilityAttributes;
}

/** Props that the binder adds to components with validation checks. */
export interface CheckableResolvedProps {
  isValid?: boolean;
  validationErrors?: string[];
}

let nextBasicElementDomId = 0;

/**
 * Internal base class for the built-in Basic Catalog components.
 *
 * Extends `A2uiLitElement` to inject global basic catalog CSS, map `props.weight` to flex,
 * and calculate `--a2ui-color-primary` CSS variables from the surface theme.
 *
 * @template Api The component API, or a union of the APIs of every protocol
 *     version the element supports. Props are inferred from each API's schema.
 * @internal
 */
export abstract class BasicCatalogA2uiLitElement<Api extends ComponentApi> extends A2uiLitElement<
  Api,
  ResolveA2uiProps<InferredComponentApiSchemaType<Api>>
> {
  /**
   * Document-unique ID prefix for associating internal labels, controls, and error messages.
   */
  protected readonly domId = `a2ui-bc-${++nextBasicElementDomId}`;

  /**
   * Renders into the element's direct children (Light DOM) instead of a ShadowRoot.
   */
  override createRenderRoot() {
    return this;
  }

  /**
   * Lifecycle hook invoked when the element is connected to the DOM.
   * Injects global basic catalog CSS.
   */
  override connectedCallback() {
    super.connectedCallback();
    injectBasicCatalogStyles();
  }

  /**
   * Lifecycle hook invoked before rendering.
   * Resolves the component flex weight and calculates theme color CSS variables.
   *
   * @param changedProperties Map of changed properties with their previous values.
   */
  override willUpdate(changedProperties: Map<string, any>) {
    super.willUpdate(changedProperties);

    const props = this.controller?.props as CommonResolvedProps | undefined;
    if (props && props.weight !== undefined) {
      this.style.flex = String(props.weight);
    } else {
      this.style.removeProperty('flex');
    }

    const primaryColor = this.context?.theme?.primaryColor;
    if (typeof primaryColor === 'string' && isValidCssColor(primaryColor)) {
      this.style.setProperty('--a2ui-color-primary', primaryColor);
      this.style.setProperty(
        '--a2ui-color-primary-light',
        computeColorVariant('light', {colorVar: '--a2ui-color-primary'}),
      );
      this.style.setProperty(
        '--a2ui-color-primary-dark',
        computeColorVariant('dark', {colorVar: '--a2ui-color-primary'}),
      );
      this.style.setProperty(
        '--a2ui-color-primary-hover',
        computeColorVariant('hover', {
          darkVar: '--a2ui-color-primary-dark',
          lightVar: '--a2ui-color-primary-light',
        }),
      );
    } else {
      this.style.removeProperty('--a2ui-color-primary');
      this.style.removeProperty('--a2ui-color-primary-light');
      this.style.removeProperty('--a2ui-color-primary-dark');
      this.style.removeProperty('--a2ui-color-primary-hover');
    }
    this.applyAccessibilityAttributes(props?.accessibility);
  }

  protected getAccessibilityLabel(a11y?: ResolvedAccessibilityAttributes): string | typeof nothing {
    return this.hasAttributeValue(a11y?.label) ? String(a11y?.label) : nothing;
  }

  protected getAccessibilityDescription(
    a11y?: ResolvedAccessibilityAttributes,
  ): string | typeof nothing {
    return this.hasAttributeValue(a11y?.description) ? String(a11y?.description) : nothing;
  }

  protected hasValidationErrors(props?: CheckableResolvedProps): boolean {
    return props?.isValid === false && Boolean(props.validationErrors?.length);
  }

  protected getValidationErrorId(props?: CheckableResolvedProps): string | typeof nothing {
    return this.hasValidationErrors(props) ? `${this.domId}-error` : nothing;
  }

  protected renderValidationErrors(props?: CheckableResolvedProps) {
    if (this.hasValidationErrors(props)) {
      return html`
        <div id="${this.domId}-error" class="a2ui-validation-errors" role="alert">
          ${props!.validationErrors!.map(
            (msg: string) => html`<div class="a2ui-error-message">${msg}</div>`,
          )}
        </div>
      `;
    }
    return nothing;
  }

  /**
   * Applies group-level `role`, `aria-label`, and `aria-description` directly onto
   * wrapperless layout host elements (`Column` and `Row`) only when explicitly set.
   */
  protected applyContainerAccessibilityAttributes(a11y?: ResolvedAccessibilityAttributes): void {
    if (this.hasAttributeValue(a11y?.label)) {
      this.setAttribute('role', 'group');
      this.setAttribute('aria-label', String(a11y?.label));
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
    }
    if (this.hasAttributeValue(a11y?.description)) {
      this.setAttribute('aria-description', String(a11y?.description));
    } else {
      this.removeAttribute('aria-description');
    }
  }

  private applyAccessibilityAttributes(a11y?: ResolvedAccessibilityAttributes): void {
    if (this.hasAttributeValue(a11y?.live)) {
      this.setAttribute('aria-live', String(a11y?.live));
    } else {
      this.removeAttribute('aria-live');
    }
    if (typeof a11y?.hidden === 'boolean') {
      this.setAttribute('aria-hidden', String(a11y.hidden));
    } else {
      this.removeAttribute('aria-hidden');
    }
  }

  protected hasAttributeValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
  }
}
