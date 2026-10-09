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

import {LitElement, nothing} from 'lit';
import {Directive, directive, type DirectiveResult} from 'lit/directive.js';
import {ComponentContext} from '../resolution/component-context.js';
import {isComponentNode, type ComponentNode} from '../resolution/component-node.js';
import {Catalog} from '../catalog/types.js';
import {isWebComponentImplementation} from './is_web_component_implementation.js';
import {registerUniversalElement} from './register_universal_element.js';
import type {WebComponentImplementation} from './web_component_implementation.js';
import type {A2uiWebComponentElement} from './a2ui_web_component_element.js';

const BLOCKED_CUSTOM_ELEMENT_PROPS = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
  'innerHTML',
  'outerHTML',
  'innerText',
  'outerText',
  'textContent',
  'srcdoc',
  'is',
  'formaction',
  'formAction',
  'href',
  'src',
  'style',
  'dataset',
  'attributes',
  'className',
  'classList',
  'part',
  'shadowRoot',
  'id',
  'slot',
  'component',
  'weight',
  'processor',
  'surfaceId',
  'surface',
  'dataContextPath',
  'childComponents',
  'enableCustomElements',
  'theme',
  'renderOptions',
  'renderRoot',
  'isUpdatePending',
  'hasUpdated',
  'updateComplete',
]);

interface CachedCtorProps {
  baseCtor: unknown;
  allowed: Set<string>;
  stateProps: Set<string>;
  baseElementProps?: Map<PropertyKey, unknown>;
}

const SCHEMA_ALLOWED_PROPS_CACHE = new WeakMap<object, Set<string>>();
const CTOR_ALLOWED_PROPS_CACHE = new WeakMap<CustomElementConstructor, CachedCtorProps>();

/**
 * Options for filtering and applying server-supplied properties onto a custom element.
 */
export interface CustomElementPropertyOptions {
  elCtor?: CustomElementConstructor;
  baseCtor?: unknown;
  schema?: unknown;
}

function isBaseElementPrototype(proto: object): boolean {
  const reactiveElementProto = Object.getPrototypeOf(LitElement.prototype);
  const litBaseElementProto = reactiveElementProto
    ? Object.getPrototypeOf(reactiveElementProto)
    : null;
  if (
    proto === Object.prototype ||
    proto === LitElement.prototype ||
    proto === reactiveElementProto ||
    proto === litBaseElementProto
  ) {
    return true;
  }
  if (typeof HTMLElement !== 'undefined' && proto === HTMLElement.prototype) {
    return true;
  }
  if (typeof Element !== 'undefined' && proto === Element.prototype) {
    return true;
  }
  if (typeof Node !== 'undefined' && proto === Node.prototype) {
    return true;
  }
  if (typeof EventTarget !== 'undefined' && proto === EventTarget.prototype) {
    return true;
  }
  return false;
}

/**
 * Returns whether a property name is safe to set from server-supplied component data.
 */
export function isSafeCustomProperty(prop: string): boolean {
  if (!prop || BLOCKED_CUSTOM_ELEMENT_PROPS.has(prop)) {
    return false;
  }
  const lower = prop.toLowerCase();
  if (
    lower.startsWith('on') ||
    lower.startsWith('data-') ||
    prop.startsWith('_') ||
    prop.startsWith('#')
  ) {
    return false;
  }
  return true;
}

function getSchemaAllowedProperties(schema: unknown): Set<string> | null {
  if (
    schema &&
    typeof schema === 'object' &&
    'properties' in schema &&
    schema.properties &&
    typeof schema.properties === 'object'
  ) {
    const cached = SCHEMA_ALLOWED_PROPS_CACHE.get(schema);
    if (cached) {
      return cached;
    }
    const allowed = new Set<string>();
    for (const key of Object.keys(schema.properties)) {
      if (isSafeCustomProperty(key)) {
        allowed.add(key);
      }
    }
    SCHEMA_ALLOWED_PROPS_CACHE.set(schema, allowed);
    return allowed;
  }
  return null;
}

function getCtorAllowedProperties(
  elCtor: CustomElementConstructor,
  baseCtor: unknown,
  isLitInstance: boolean,
): CachedCtorProps {
  const cached = CTOR_ALLOWED_PROPS_CACHE.get(elCtor);
  if (cached && cached.baseCtor === baseCtor) {
    return cached;
  }

  const allowed = new Set<string>();
  const stateProps = new Set<string>();
  (baseCtor as {finalize?: () => void} | undefined)?.finalize?.();
  (elCtor as unknown as {finalize?: () => void}).finalize?.();

  const baseElementProps = (baseCtor as {elementProperties?: Map<PropertyKey, unknown>} | undefined)
    ?.elementProperties;
  const ctorElementProps = (
    elCtor as unknown as {elementProperties?: Map<PropertyKey, {state?: boolean}>}
  ).elementProperties;

  if (ctorElementProps instanceof Map) {
    for (const [key, decl] of ctorElementProps.entries()) {
      if (typeof key !== 'string') continue;
      if (decl?.state) {
        stateProps.add(key);
        continue;
      }
      if (baseElementProps?.has(key)) {
        continue;
      }
      if (isSafeCustomProperty(key)) {
        allowed.add(key);
      }
    }
  }

  const baseObserved = new Set<string>(
    (baseCtor as {observedAttributes?: string[]} | undefined)?.observedAttributes ?? [],
  );
  const observedAttrs = (elCtor as unknown as {observedAttributes?: unknown}).observedAttributes;
  if (Array.isArray(observedAttrs)) {
    for (const attr of observedAttrs) {
      if (
        typeof attr === 'string' &&
        !baseObserved.has(attr) &&
        !stateProps.has(attr) &&
        isSafeCustomProperty(attr)
      ) {
        allowed.add(attr);
      }
    }
  }

  if (!isLitInstance || allowed.size === 0) {
    const baseProto = (baseCtor as {prototype?: object} | undefined)?.prototype;
    const baseMixinProto = baseProto ? Object.getPrototypeOf(baseProto) : null;
    let proto = elCtor.prototype;
    while (
      proto &&
      proto !== baseProto &&
      proto !== baseMixinProto &&
      !isBaseElementPrototype(proto)
    ) {
      for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
        if (stateProps.has(key) || baseElementProps?.has(key) || !isSafeCustomProperty(key)) {
          continue;
        }
        if (
          typeof desc.set === 'function' ||
          ('value' in desc && typeof desc.value !== 'function')
        ) {
          allowed.add(key);
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
  }

  const entry: CachedCtorProps = {
    baseCtor,
    allowed,
    stateProps,
    baseElementProps,
  };
  CTOR_ALLOWED_PROPS_CACHE.set(elCtor, entry);
  return entry;
}

/**
 * Computes the set of safe, declared custom properties allowed on a custom element instance.
 */
export function getAllowedCustomProperties(
  el: HTMLElement,
  options: CustomElementPropertyOptions = {},
): Set<string> {
  const schemaAllowed = getSchemaAllowedProperties(options.schema);
  if (schemaAllowed !== null) {
    return schemaAllowed;
  }

  const elCtor = options.elCtor ?? (el.constructor as CustomElementConstructor);
  const isLitInstance = el instanceof LitElement;
  const {allowed, stateProps, baseElementProps} = getCtorAllowedProperties(
    elCtor,
    options.baseCtor,
    isLitInstance,
  );

  if (isLitInstance) {
    return allowed;
  }

  let instanceAllowed: Set<string> | null = null;
  for (const key of Object.getOwnPropertyNames(el)) {
    if (
      !allowed.has(key) &&
      !stateProps.has(key) &&
      !baseElementProps?.has(key) &&
      isSafeCustomProperty(key)
    ) {
      instanceAllowed ??= new Set<string>(allowed);
      instanceAllowed.add(key);
    }
  }

  return instanceAllowed ?? allowed;
}

/**
 * Safely assigns server-supplied component properties onto a custom element instance,
 * restricting assignment to declared and non-dangerous properties.
 */
export function applyCustomElementProperties(
  el: HTMLElement,
  properties: unknown,
  options: CustomElementPropertyOptions = {},
): void {
  if (!properties || typeof properties !== 'object') {
    return;
  }
  const allowedProps = getAllowedCustomProperties(el, options);
  for (const [prop, val] of Object.entries(properties)) {
    if (!isSafeCustomProperty(prop) || !allowedProps.has(prop)) {
      continue;
    }
    (el as unknown as Record<string, unknown>)[prop] = val;
  }
}

/**
 * Keeps one custom element per child position, so a parent re-render
 * updates the element in place instead of replacing it. The element is
 * recreated only when the tag name changes.
 */
class A2uiElementDirective extends Directive {
  private tagName?: string;
  private element?: A2uiWebComponentElement;

  render(tagName: string, context: ComponentContext, node?: ComponentNode) {
    if (!this.element || this.tagName !== tagName) {
      this.tagName = tagName;
      this.element = document.createElement(tagName) as A2uiWebComponentElement;
    }
    this.element.node = node;
    this.element.context = context;
    return this.element;
  }
}

const a2uiElement = directive(A2uiElementDirective);

/**
 * Pure function that acts as a generic container for A2UI components.
 *
 * It dynamically resolves and renders the specific Lit component implementation
 * based on the component type provided in the context, returning a TemplateResult directly
 * to avoid duplicate DOM node wrapping.
 *
 * @param context The component context defining the data model and type to render.
 * @param catalog The catalog of component implementations.
 * @returns A Lit directive result rendering the component's custom element, or `nothing` if the component is invalid or unresolvable.
 */
export function renderA2uiNode(
  context: ComponentContext,
  catalog: Catalog<WebComponentImplementation>,
): DirectiveResult | typeof nothing;
/**
 * Renders a resolved node as its implementation's custom element, handing
 * the element the node and its context.
 *
 * @param node The resolved node to render.
 * @returns A Lit directive result rendering the component's custom element,
 * or `nothing` for a placeholder, a disposed node, or an implementation that
 * is not a Web Component.
 */
export function renderA2uiNode(node: ComponentNode): DirectiveResult | typeof nothing;
export function renderA2uiNode(
  source: ComponentContext | ComponentNode,
  catalog?: Catalog<WebComponentImplementation>,
) {
  if (isComponentNode(source)) {
    return renderNode(source);
  }
  const type = source.componentModel.type;
  const implementation = catalog?.components.get(type);

  if (!implementation || !implementation.tagName) {
    console.warn(`Component implementation not found or missing tagName for type: ${type}`);
    return nothing;
  }

  // A catalog can also hold entries whose element another framework's adapter
  // already defined; those carry a tag name but no element to register.
  if (
    isWebComponentImplementation(implementation) &&
    typeof customElements !== 'undefined' &&
    !customElements.get(implementation.tagName)
  ) {
    registerUniversalElement(implementation);
  }

  return a2uiElement(implementation.tagName, source);
}

function renderNode(node: ComponentNode) {
  if (node.isPlaceholder || node.disposed || !node.context) {
    return nothing;
  }
  const implementation = node.impl as Partial<WebComponentImplementation> | undefined;
  if (!implementation?.tagName) {
    console.warn(`Component implementation not found or missing tagName for type: ${node.type}`);
    return nothing;
  }
  if (isWebComponentImplementation(implementation)) {
    registerUniversalElement(implementation);
  }
  return a2uiElement(implementation.tagName, node.context, node);
}
