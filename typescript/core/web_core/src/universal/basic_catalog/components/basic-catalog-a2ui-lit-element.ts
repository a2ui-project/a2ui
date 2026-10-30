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

import {ComponentApi, type InferredComponentApiSchemaType} from '../../../catalog/types.js';
import type {ResolveA2uiProps} from '../../../resolution/generic-binder.js';
import {nextNodeId} from '../../../resolution/node-id.js';
import {A2uiLitElement} from '../../index.js';
import {injectBasicCatalogStyles, computeColorVariant} from '../styles/default.js';
import {isValidCssColor} from '../theme.js';
import {
  setHostAccessibilityAttributes,
  type ResolvedAccessibilityAttributes,
} from './accessibility.js';

/**
 * The resolved props this base class reads. Not every protocol version
 * defines all of them, so each one is optional.
 */
interface CommonResolvedProps {
  weight?: number;
  accessibility?: ResolvedAccessibilityAttributes;
}

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
  private fallbackDomId?: string;

  /**
   * Document-unique ID prefix for associating internal labels, controls, and error messages.
   *
   * Reads `ComponentNode.id` when rendered through a `NodeResolver`; an element mounted
   * with only a `ComponentContext` draws one lazily from the same id sequence.
   */
  protected get domId(): string {
    return this.node?.id ?? (this.fallbackDomId ??= nextNodeId());
  }

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
    setHostAccessibilityAttributes(this, props?.accessibility);
  }
}
