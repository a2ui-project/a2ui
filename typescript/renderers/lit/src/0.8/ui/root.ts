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

import {SignalWatcher} from '@lit-labs/signals';
import {consume} from '@lit/context';
import {css, html, LitElement, nothing, PropertyValues, render, TemplateResult} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {map} from 'lit/directives/map.js';
import {effect} from 'signal-utils/subtle/microtask-effect';
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';
import {StringValue} from '@a2ui/web_core/types/primitives';
import {AnyComponentNode, SurfaceID, Theme} from '@a2ui/web_core/types/types';
import {themeContext} from './context/theme.js';
import {structuralStyles} from './styles.js';
import {componentRegistry} from './component-registry.js';

type NodeOfType<T extends AnyComponentNode['type']> = Extract<AnyComponentNode, {type: T}>;

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

  if (!isLitInstance) {
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

  if (isLitInstance || allowed.size > 0) {
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

// This is the base class all the components will inherit
@customElement('a2ui-root')
export class Root extends SignalWatcher(LitElement) {
  @property()
  accessor surfaceId: SurfaceID | null = null;

  @property()
  accessor component: AnyComponentNode | null = null;

  @consume({context: themeContext})
  accessor theme!: Theme;

  @property({attribute: false})
  accessor childComponents: AnyComponentNode[] | null = null;

  @property({attribute: false})
  accessor processor: A2uiMessageProcessor | null = null;

  @property()
  accessor dataContextPath: string = '';

  @property()
  accessor enableCustomElements = false;

  @property()
  set weight(weight: string | number) {
    this.#weight = weight;
    this.style.setProperty('--weight', `${weight}`);
  }

  get weight() {
    return this.#weight;
  }

  #weight: string | number = 1;

  static override styles = [
    structuralStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 80%;
      }
    `,
  ];

  /**
   * Holds the cleanup function for our effect.
   * We need this to stop the effect when the component is disconnected.
   */
  #lightDomEffectDisposer: null | (() => void) = null;

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has('childComponents')) {
      if (this.#lightDomEffectDisposer) {
        this.#lightDomEffectDisposer();
      }

      // This effect watches the A2UI Children signal and updates the Light DOM.
      this.#lightDomEffectDisposer = effect(() => {
        // 1. Read the signal to create the subscription.
        const allChildren = this.childComponents ?? null;

        // 2. Generate the template for the children.
        const lightDomTemplate = this.renderComponentTree(allChildren);

        // 3. Imperatively render that template into the component itself.
        render(lightDomTemplate, this, {host: this});
      });
    }
  }

  /**
   * Clean up the effect when the component is removed from the DOM.
   */
  override disconnectedCallback(): void {
    super.disconnectedCallback();

    if (this.#lightDomEffectDisposer) {
      this.#lightDomEffectDisposer();
    }
  }

  /**
   * Turns the SignalMap into a renderable TemplateResult for Lit.
   */
  private renderComponentTree(
    components: AnyComponentNode[] | null,
  ): TemplateResult | typeof nothing {
    if (!components) {
      return nothing;
    }

    if (!Array.isArray(components)) {
      return nothing;
    }

    return html` ${map(components, component => {
      // 1. Check if there is a registered custom component or override.
      if (this.enableCustomElements) {
        const registeredCtor = componentRegistry.get(component.type);
        // We also check customElements.get for non-registered but defined elements
        const elCtor = registeredCtor || customElements.get(component.type);

        if (elCtor) {
          return this.instantiateCustomElement(component, elCtor);
        }
      }

      // 2. Fallback to standard components.
      switch (component.type) {
        case 'List': {
          const node = component as NodeOfType<'List'>;
          const childComponents = node.properties.children;
          return html`<a2ui-list
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .direction=${node.properties.direction ?? 'vertical'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .childComponents=${childComponents}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-list>`;
        }

        case 'Card': {
          const node = component as NodeOfType<'Card'>;
          let childComponents: AnyComponentNode[] | null = node.properties.children;
          if (!childComponents && node.properties.child) {
            childComponents = [node.properties.child];
          }

          return html`<a2ui-card
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .childComponents=${childComponents}
            .dataContextPath=${node.dataContextPath ?? ''}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-card>`;
        }

        case 'Column': {
          const node = component as NodeOfType<'Column'>;
          return html`<a2ui-column
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .childComponents=${node.properties.children ?? null}
            .dataContextPath=${node.dataContextPath ?? ''}
            .alignment=${node.properties.alignment ?? 'stretch'}
            .distribution=${node.properties.distribution ?? 'start'}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-column>`;
        }

        case 'Row': {
          const node = component as NodeOfType<'Row'>;
          return html`<a2ui-row
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .childComponents=${node.properties.children ?? null}
            .dataContextPath=${node.dataContextPath ?? ''}
            .alignment=${node.properties.alignment ?? 'stretch'}
            .distribution=${node.properties.distribution ?? 'start'}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-row>`;
        }

        case 'Image': {
          const node = component as NodeOfType<'Image'>;
          return html`<a2ui-image
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .url=${node.properties.url ?? null}
            .dataContextPath=${node.dataContextPath ?? ''}
            .usageHint=${node.properties.usageHint}
            .fit=${node.properties.fit}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-image>`;
        }

        case 'Icon': {
          const node = component as NodeOfType<'Icon'>;
          return html`<a2ui-icon
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .name=${node.properties.name ?? null}
            .dataContextPath=${node.dataContextPath ?? ''}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-icon>`;
        }

        case 'AudioPlayer': {
          const node = component as NodeOfType<'AudioPlayer'>;
          return html`<a2ui-audioplayer
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .url=${node.properties.url ?? null}
            .dataContextPath=${node.dataContextPath ?? ''}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-audioplayer>`;
        }

        case 'Button': {
          const node = component as NodeOfType<'Button'>;
          return html`<a2ui-button
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath ?? ''}
            .action=${node.properties.action}
            .childComponents=${[node.properties.child]}
            .primary=${node.properties.primary}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-button>`;
        }

        case 'Text': {
          const node = component as NodeOfType<'Text'>;
          return html`<a2ui-text
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .model=${this.processor}
            .surfaceId=${this.surfaceId}
            .processor=${this.processor}
            .dataContextPath=${node.dataContextPath}
            .text=${node.properties.text}
            .usageHint=${node.properties.usageHint}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-text>`;
        }

        case 'CheckBox': {
          const node = component as NodeOfType<'CheckBox'>;
          return html`<a2ui-checkbox
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath ?? ''}
            .label=${node.properties.label}
            .value=${node.properties.value}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-checkbox>`;
        }

        case 'DateTimeInput': {
          const node = component as NodeOfType<'DateTimeInput'>;
          return html`<a2ui-datetimeinput
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath ?? ''}
            .enableDate=${node.properties.enableDate ?? true}
            .enableTime=${node.properties.enableTime ?? true}
            .value=${node.properties.value}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-datetimeinput>`;
        }

        case 'Divider': {
          // TODO: thickness, axis and color.
          const node = component as NodeOfType<'Divider'>;
          return html`<a2ui-divider
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .thickness=${node.properties.thickness}
            .axis=${node.properties.axis}
            .color=${node.properties.color}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-divider>`;
        }

        case 'MultipleChoice': {
          // TODO: maxAllowedSelections and selections.
          const node = component as NodeOfType<'MultipleChoice'>;
          return html`<a2ui-multiplechoice
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .options=${node.properties.options}
            .maxAllowedSelections=${node.properties.maxAllowedSelections}
            .selections=${node.properties.selections}
            .variant=${(node as any).properties.variant}
            .filterable=${node.properties.filterable}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-multiplechoice>`;
        }

        case 'Slider': {
          const node = component as NodeOfType<'Slider'>;
          return html`<a2ui-slider
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .value=${node.properties.value}
            .minValue=${node.properties.minValue}
            .maxValue=${node.properties.maxValue}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-slider>`;
        }

        case 'TextField': {
          // TODO: type and validationRegexp.
          const node = component as NodeOfType<'TextField'>;
          return html`<a2ui-textfield
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .label=${node.properties.label}
            .text=${node.properties.text}
            .textFieldType=${node.properties.textFieldType}
            .validationRegexp=${node.properties.validationRegexp}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-textfield>`;
        }

        case 'Video': {
          const node = component as NodeOfType<'Video'>;
          return html`<a2ui-video
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .url=${node.properties.url}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-video>`;
        }

        case 'Tabs': {
          const node = component as NodeOfType<'Tabs'>;
          const titles: StringValue[] = [];
          const childComponents: AnyComponentNode[] = [];
          if (node.properties.tabItems) {
            for (const item of node.properties.tabItems) {
              titles.push(item.title);
              childComponents.push(item.child);
            }
          }

          return html`<a2ui-tabs
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .titles=${titles}
            .childComponents=${childComponents}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-tabs>`;
        }

        case 'Modal': {
          const node = component as NodeOfType<'Modal'>;
          const childComponents: AnyComponentNode[] = [
            node.properties.entryPointChild,
            node.properties.contentChild,
          ];

          node.properties.entryPointChild.slotName = 'entry';

          return html`<a2ui-modal
            id=${node.id}
            slot=${node.slotName ? node.slotName : nothing}
            .component=${node}
            .weight=${node.weight ?? 'initial'}
            .processor=${this.processor}
            .surfaceId=${this.surfaceId}
            .dataContextPath=${node.dataContextPath}
            .childComponents=${childComponents}
            .enableCustomElements=${this.enableCustomElements}
          ></a2ui-modal>`;
        }

        default: {
          return this.renderCustomComponent(component);
        }
      }
    })}`;
  }

  private renderCustomComponent(component: AnyComponentNode) {
    if (!this.enableCustomElements) {
      return;
    }

    const registeredCtor = componentRegistry.get(component.type);
    const elCtor = registeredCtor || customElements.get(component.type);

    if (!elCtor) {
      return html`Unknown element ${component.type}`;
    }

    return this.instantiateCustomElement(component, elCtor);
  }

  private instantiateCustomElement(component: AnyComponentNode, elCtor: CustomElementConstructor) {
    const node = component as AnyComponentNode;
    const el = new elCtor() as Root;

    el.id = node.id;
    if (node.slotName) {
      el.slot = node.slotName;
    }
    el.component = node;
    el.weight = node.weight ?? 'initial';
    el.processor = this.processor;
    el.surfaceId = this.surfaceId;
    el.dataContextPath = node.dataContextPath ?? '/';

    const schema = componentRegistry.getSchema(component.type, elCtor);
    applyCustomElementProperties(el, component.properties, {
      elCtor,
      baseCtor: Root,
      schema,
    });
    return html`${el}`;
  }

  override render(): TemplateResult | typeof nothing {
    return html`<slot></slot>`;
  }
}
