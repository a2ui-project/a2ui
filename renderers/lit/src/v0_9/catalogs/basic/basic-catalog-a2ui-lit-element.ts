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

import {ComponentApi, type ComponentId} from '@a2ui/web_core/v0_9';
import {css, type CSSResult} from 'lit';
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
  /**
   * Renders into the element's direct children (Light DOM) instead of a ShadowRoot.
   */
  override createRenderRoot() {
    return this;
  }

  private adoptStyles() {
    if (typeof document === 'undefined') return;
    const root = this.getRootNode() as Document | ShadowRoot;

    const constructor = this.constructor as typeof BasicCatalogA2uiLitElement & {
      _processedSheet?: CSSStyleSheet;
      _processedCss?: string;
      _processedStyle?: CSSResult;
      _adoptedRoots?: WeakSet<Node>;
    };
    const styles = constructor.styles;
    if (!styles) return;

    const tagName = this.tagName.toLowerCase();

    if (!constructor._processedStyle) {
      const styleList = Array.isArray(styles) ? styles : [styles];
      const rawCss = styleList
        .map(s =>
          s && typeof s === 'object' && 'cssText' in s ? String((s as any).cssText) : String(s),
        )
        .join('\n');

      // In Light DOM, replace :host selectors with the specific tagName
      // and scope descendant selectors to avoid leaking styles to other components.
      const baseCss = rawCss
        .replace(/:where\(:host\)/g, `:where(${tagName})`)
        .replace(/:host\(([^)]+)\)/g, `${tagName}$1`)
        .replace(/:host/g, tagName);

      let processedCss = baseCss;

      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(baseCss);

        const scopeRule = (rule: CSSRule): string => {
          if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
            const scopedSelectors = rule.selectorText
              .split(',')
              .map(sel => {
                sel = sel.trim();
                if (
                  sel === tagName ||
                  sel.startsWith(tagName + ' ') ||
                  sel.startsWith(tagName + '.') ||
                  sel.startsWith(tagName + ':') ||
                  sel.startsWith(tagName + '[') ||
                  sel.startsWith(`:where(${tagName}`) ||
                  sel.startsWith(`:is(${tagName}`)
                ) {
                  return sel;
                }
                return `${tagName} ${sel}`;
              })
              .join(', ');
            return `${scopedSelectors} { ${rule.style.cssText} }`;
          } else if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
            const inner = Array.from(rule.cssRules).map(scopeRule).join('\n');
            return `@media ${rule.conditionText} {\n${inner}\n}`;
          }
          return rule.cssText;
        };

        processedCss = Array.from(sheet.cssRules).map(scopeRule).join('\n');
        const scopedSheet = new CSSStyleSheet();
        scopedSheet.replaceSync(processedCss);
        constructor._processedSheet = scopedSheet;
      } catch {
        // Fallback for environments lacking CSSStyleSheet support
      }

      constructor._processedCss = processedCss;
      constructor._processedStyle = css([processedCss] as unknown as TemplateStringsArray);
      constructor._adoptedRoots = new WeakSet();
    }

    const target =
      typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
        ? root
        : typeof document !== 'undefined'
          ? document
          : undefined;

    if (target) {
      if (!constructor._adoptedRoots) {
        constructor._adoptedRoots = new WeakSet();
      }
      if (!constructor._adoptedRoots.has(target)) {
        constructor._adoptedRoots.add(target);
        if (constructor._processedSheet && (target as any).adoptedStyleSheets) {
          (target as any).adoptedStyleSheets = [
            ...(target as any).adoptedStyleSheets,
            constructor._processedSheet,
          ];
        }
      }
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    injectBasicCatalogStyles();
    this.adoptStyles();
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
