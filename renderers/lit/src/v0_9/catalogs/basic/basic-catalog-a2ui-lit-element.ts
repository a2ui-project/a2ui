/*
 * Copyright 2026 Google LLC
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

import {ComponentApi, type ComponentId} from '@a2ui/web_core/v0_9';
import {A2uiLitElement} from '../../a2ui-lit-element.js';
import {injectBasicCatalogStyles, computeColorVariant} from '@a2ui/web_core/v0_9/basic_catalog';

export type ResolvedChildRef =
  | ComponentId
  | {
      id: ComponentId;
      basePath: string;
    };

export type ResolvedChildList = ResolvedChildRef[];

/**
 * A base class for A2UI basic catalog components.
 *
 * Handles some common features of all basic catalog A2ui elements, like
 * injecting the basic CSS styles if needed, and setting the flex property
 * if set by the framework.
 */
export abstract class BasicCatalogA2uiLitElement<
  Api extends ComponentApi,
> extends A2uiLitElement<Api> {
  override connectedCallback() {
    super.connectedCallback();
    injectBasicCatalogStyles();
  }

  override willUpdate(changedProperties: Map<string, any>) {
    super.willUpdate(changedProperties);

    const props = this.controller?.props as any;
    if (props && props.weight !== undefined) {
      this.style.flex = String(props.weight);
    } else {
      this.style.removeProperty('flex');
    }

    const primaryColor = this.context?.theme?.primaryColor;
    if (primaryColor) {
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
  }
}
