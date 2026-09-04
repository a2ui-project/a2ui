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

import {LitElement, css, nothing, type CSSResult, type PropertyValues} from 'lit';
import {property} from 'lit/decorators.js';
import {ComponentContext} from '../rendering/component-context.js';
import {Catalog, ComponentApi, WebComponentImplementation} from './types.js';
import {type ComponentId} from '../schema/common-types.js';
import {renderA2uiNode} from './render-a2ui-node.js';
import {A2uiController} from './a2ui-controller.js';

/**
 * A reference to a child component to render. Either a string ID, or an object
 * pairing an ID with an explicit data context path.
 */
export type A2uiChildRef =
  | ComponentId
  | {
      id: ComponentId;
      basePath: string;
    };

export type ResolvedChildList = A2uiChildRef[];

/**
 * A base class for A2UI Lit elements that manages the A2uiController lifecycle
 * and provides Light DOM style adoption and scoping.
 *
 * By default, elements render into the Light DOM (direct children) to enable
 * universal CSS cascade, styling, and cross-framework composition. To opt into
 * Shadow DOM encapsulation, subclasses can override `createRenderRoot()` to return
 * `super.createRenderRoot()`.
 *
 * @template Api The specific A2UI component API defining the schema for this element.
 * @experimental This class is experimental and subject to change as A2UI transitions
 * to the unified Node Layer resolution pipeline.
 */
export abstract class A2uiLitElement<Api extends ComponentApi = ComponentApi> extends LitElement {
  @property({type: Object}) context!: ComponentContext;

  /**
   * Component API specification for automatic controller instantiation.
   */
  protected readonly api?: Api;

  /**
   * The reactive controller instance managing property bindings and state subscriptions.
   */
  public controller!: A2uiController<Api>;

  /**
   * Adopts and scopes component CSS rules into the containing document or shadow root.
   *
   * When rendering in Light DOM, this method dynamically scopes `:host` selectors to the
   * element's custom tag name and prefixes descendant rules to prevent stylesheet leakage.
   */
  protected adoptLightDomStyles() {
    if (typeof document === 'undefined') return;
    const root = this.getRootNode() as Document | ShadowRoot;

    const constructor = this.constructor as typeof A2uiLitElement & {
      _processedSheet?: CSSStyleSheet;
      _processedCss?: string;
      _processedStyle?: CSSResult;
      _adoptedRoots?: WeakSet<Node>;
    };
    const styles = (constructor as any).styles;
    if (!styles) return;

    const tagName = this.tagName.toLowerCase();

    if (!constructor._processedSheet && constructor._processedCss === undefined) {
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

        // Scopes CSS rules by prefixing child selectors with the component's custom element tag name,
        // while preserving host-level pseudo-classes (:where, :is, class modifiers, attributes).
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

  /**
   * Lifecycle hook invoked when the element is connected to the DOM.
   * Scopes and adopts component styles into the document or host shadow root.
   */
  override connectedCallback() {
    super.connectedCallback();
    this.adoptLightDomStyles();
  }

  /**
   * Instantiates the controller for this element's specific bound API.
   *
   * By default, this creates an `A2uiController` using the instance `api` property.
   * Subclasses can override this method if custom controller initialization is required.
   *
   * @returns A new instance of `A2uiController` matching the component API.
   */
  protected createController(): A2uiController<Api> {
    if (!this.api) {
      throw new Error(
        `[A2uiLitElement] Either define 'protected readonly api = ...' on ${this.constructor.name} or override 'createController()'.`,
      );
    }
    return new A2uiController(this, this.api);
  }

  /**
   * Helper method to render a child A2UI node.
   * Abstracts away the need to manually create a ComponentContext.
   *
   * @param childRef The reference to the child component to render. Either a string ID
   *                 or a reference object containing `{id, basePath}`.
   * @param customPath An explicit data model path to bind the child to. If provided,
   *                   this overrides any path defined in the `childRef` object. If omitted,
   *                   falls back to the `childRef`'s `basePath`, or the current component's path.
   *
   * @returns A Lit template result containing the rendered child component, or `nothing` if the reference is empty.
   */
  protected renderNode(childRef?: A2uiChildRef, customPath?: string) {
    if (!childRef) return nothing;
    const {surface, path: parentPath} = this.context.dataContext;

    const surfaceContainsComponent = !!surface.componentsModel?.get(this.context.componentModel.id);
    if (!surfaceContainsComponent) {
      return nothing;
    }

    let componentId: ComponentId | undefined;
    let path = customPath;
    if (typeof childRef === 'object') {
      componentId = (childRef as any).id || (childRef as any).componentId;
      path = path ?? (childRef as any).basePath ?? (childRef as any).path;
    } else {
      componentId = childRef;
    }

    if (!componentId || !surface.componentsModel?.get(componentId)) {
      return nothing;
    }

    path = path ?? parentPath;

    return renderA2uiNode(
      new ComponentContext(surface, componentId, path),
      surface.catalog as Catalog<WebComponentImplementation>,
    );
  }

  /**
   * Reacts to changes in the component's properties.
   *
   * Specifically, when the `context` property changes or is initialized, this method
   * cleans up any existing controller and invokes `createController()` to bind to
   * the new context.
   *
   * @param changedProperties Map of changed properties with their previous values.
   */
  override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);
    if (changedProperties.has('context') && this.context) {
      if (this.controller) {
        this.removeController(this.controller);
        this.controller.dispose();
      }
      this.controller = this.createController();
    }
  }

  protected override update(changedProperties: PropertyValues) {
    if (!this.controller) {
      return;
    }
    super.update(changedProperties);
  }
}
