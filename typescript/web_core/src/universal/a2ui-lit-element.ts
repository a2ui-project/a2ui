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
import {ComponentContext} from '../resolution/component-context.js';
import {isComponentNode, type ComponentNode} from '../resolution/component-node.js';
import {ResolvedBinding} from '../resolution/resolved-binding.js';
import {peekValue} from '../reactivity/signals.js';
import type {Catalog, ComponentApi, InferredComponentApiSchemaType} from '../catalog/types.js';
import type {ResolveA2uiProps} from '../resolution/generic-binder.js';
import type {WebComponentImplementation} from './web_component_implementation.js';
import {type ComponentId} from '../types/common-types.js';
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

export type ResolvedChildRef = A2uiChildRef;
export type ResolvedChildList = A2uiChildRef[];

/**
 * A base class for A2UI Lit elements that manages the A2uiController lifecycle
 * and provides Light DOM style adoption and scoping.
 *
 * Subclasses declare the component API they implement as
 * `protected readonly api = ...`; the controller is created from it when the
 * element receives its `context`. Elements render into a Shadow DOM by default
 * (standard `LitElement` behavior). Subclasses that render into the Light DOM
 * override `createRenderRoot()` to return `this`; their styles are then scoped
 * to the element's tag name and adopted into the enclosing root.
 *
 * @template Api The specific A2UI component API defining the schema for this element.
 * @experimental This class is experimental and subject to change as A2UI transitions
 * to the unified Node Layer resolution pipeline.
 */
export abstract class A2uiLitElement<
  Api extends ComponentApi = ComponentApi,
  Props = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>,
> extends LitElement {
  @property({type: Object}) context!: ComponentContext;

  /**
   * The resolved node this element renders, when its parent resolves the
   * surface through a `NodeResolver`. Assigning it also assigns `context`
   * (`node.context`), and `renderNode` then renders the node's own children.
   */
  @property({type: Object}) node?: ComponentNode;

  /**
   * Component API specification for automatic controller instantiation.
   *
   * Subclasses define it as a class field (`protected override readonly api =
   * ...`). It is read when the element receives a `context`, so it has to be
   * set before then.
   */
  protected readonly api?: Api;

  private _controller?: A2uiController<Api, Props>;
  private _controllerContext?: ComponentContext;

  /**
   * The reactive controller instance managing property bindings and state subscriptions.
   */
  public get controller(): A2uiController<Api, Props> {
    return this._controller!;
  }

  /**
   * Adopts and scopes component CSS rules into the containing document or host shadow root.
   *
   * In Light DOM (the default for A2uiLitElement), the element has no shadow root of its own,
   * so this method locates the nearest enclosing Document or ShadowRoot and adopts the
   * stylesheet once per root, scoping `:host` and descendant selectors to the element's tagName.
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
   * Uses the `api` field the subclass declares. Subclasses can override this
   * method instead if custom controller initialization is required.
   *
   * @returns A new instance of `A2uiController` matching the component API.
   * @throws If the subclass neither defines `api` nor overrides this method.
   */
  protected createController(): A2uiController<Api, Props> {
    if (!this.api) {
      throw new Error(
        `[A2uiLitElement] Either define 'protected readonly api = ...' on <${this.localName}> or override 'createController()'.`,
      );
    }
    return new A2uiController(this, this.api) as unknown as A2uiController<Api, Props>;
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
    if (!childRef || !this.context?.dataContext) return nothing;
    const {surface, path: parentPath} = this.context.dataContext;
    if (!surface) {
      return nothing;
    }

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

    if (this.node) {
      const childNode = findChildNode(this.node, componentId, path);
      if (childNode) {
        return renderA2uiNode(childNode);
      }
    }

    const childContext = new ComponentContext(surface, componentId, path);
    const childCatalog = (childContext.componentModel.catalog ??
      surface.defaultCatalog) as Catalog<WebComponentImplementation>;
    return renderA2uiNode(childContext, childCatalog);
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
    let contextChanged = changedProperties.has('context');
    if (changedProperties.has('node') && this.node?.context && this.node.context !== this.context) {
      this.context = this.node.context;
      contextChanged = true;
    }
    if (contextChanged && this.context) {
      if (this._controller && bindsSameComponent(this._controllerContext, this.context)) {
        this._controllerContext = this.context;
        return;
      }
      if (this._controller) {
        this.removeController(this._controller);
        this._controller.dispose();
      }
      this._controller = this.createController();
      this._controllerContext = this.context;
    }
  }

  protected override update(changedProperties: PropertyValues) {
    if (!this._controller) {
      return;
    }
    super.update(changedProperties);
  }
}

/**
 * Whether two `ComponentContext` instances bind the same component model at
 * the same data path on the same surface.
 *
 * Parent elements without a `ComponentNode` construct a fresh
 * `ComponentContext` in `renderNode` on every render; comparing the bound
 * targets avoids tearing down and recreating the child's `A2uiController`
 * and `GenericBinder` when nothing they observe has changed.
 */
function bindsSameComponent(
  a: ComponentContext | undefined,
  b: ComponentContext | undefined,
): boolean {
  if (a === b) return true;
  if (!a?.componentModel || !b?.componentModel || !a.dataContext || !b.dataContext) {
    return false;
  }
  return (
    a.componentModel === b.componentModel &&
    a.surfaceComponents === b.surfaceComponents &&
    a.theme === b.theme &&
    a.dataContext.surface === b.dataContext.surface &&
    a.dataContext.dataModel === b.dataContext.dataModel &&
    a.dataContext.path === b.dataContext.path &&
    a.dataContext.explicitIndex === b.dataContext.explicitIndex &&
    a.dataContext.parent === b.dataContext.parent
  );
}

/**
 * The child of `parent` for `componentId` at `dataPath`, searched through the
 * parent's resolved props (child lists, nested objects and bindings).
 */
function findChildNode(
  parent: ComponentNode,
  componentId: string,
  dataPath: string,
): ComponentNode | undefined {
  const visit = (value: unknown): ComponentNode | undefined => {
    if (isComponentNode(value)) {
      return value.componentId === componentId && value.dataPath === dataPath ? value : undefined;
    }
    if (value instanceof ResolvedBinding) {
      return visit(value.value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return undefined;
    }
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      for (const item of Object.values(value)) {
        const found = visit(item);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(peekValue(parent.props));
}
