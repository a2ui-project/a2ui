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

import {CSSResultGroup, PropertyValues} from 'lit';
import {ComponentApi} from '../catalog/types.js';
import {type ComponentId} from '../schema/common-types.js';
import {A2uiLitElement} from './a2ui-lit-element.js';
import {injectBasicCatalogStyles, computeColorVariant} from './styles/default.js';

export type ResolvedChildRef =
  | ComponentId
  | {
      id: ComponentId;
      basePath: string;
    };

export type ResolvedChildList = ResolvedChildRef[];

interface HasCustomStyles {
  styles?: CSSResultGroup;
  _stylesInjected?: boolean;
}

/**
 * Common base class for universal A2UI Basic Catalog components.
 * Renders into the Light DOM for seamless interop across frontend frameworks.
 */
export abstract class BasicCatalogA2uiLitElement<
  Api extends ComponentApi = ComponentApi,
> extends A2uiLitElement<Api> {
  /**
   * Renders into the element's direct children (Light DOM) instead of a ShadowRoot.
   */
  override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    super.connectedCallback();
    injectBasicCatalogStyles();
    this.injectComponentStyles();
  }

  /**
   * Automatically adapts and injects static styles for Light DOM custom elements.
   */
  private injectComponentStyles() {
    const ctor = this.constructor as typeof BasicCatalogA2uiLitElement & HasCustomStyles;
    if (!ctor.styles || ctor._stylesInjected) return;
    ctor._stylesInjected = true;

    if (typeof document === 'undefined') return;

    const styles = ctor.styles;
    const rawCss = Array.isArray(styles)
      ? styles
          .map(s =>
            typeof s === 'object' && s !== null && 'cssText' in s
              ? String((s as {cssText: string}).cssText)
              : String(s),
          )
          .join('\n')
      : typeof styles === 'object' && styles !== null && 'cssText' in styles
        ? String((styles as {cssText: string}).cssText)
        : String(styles);

    const tagName = this.tagName.toLowerCase();
    const convertedCss = rawCss
      .replace(/:where\(:host\)/g, `:where(${tagName})`)
      .replace(/:host\(([^)]+)\)/g, `${tagName}$1`)
      .replace(/:host/g, tagName);

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(convertedCss);
      if (!document.adoptedStyleSheets.includes(sheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    } catch {
      // Fallback for environments lacking adoptedStyleSheets support
      const styleEl = document.createElement('style');
      styleEl.textContent = convertedCss;
      document.head.appendChild(styleEl);
    }
  }

  override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);

    const props = this.controller?.props;
    if (props && 'weight' in props && typeof props.weight === 'number') {
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
